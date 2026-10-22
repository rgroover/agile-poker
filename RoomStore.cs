using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using Microsoft.AspNetCore.SignalR;

namespace AgilePoker;

public sealed class RoomStore(IHubContext<PokerHub> hub)
{
    private readonly ConcurrentDictionary<string, Room> rooms = new();
    private readonly ConcurrentDictionary<string, (string Room, string Member)> connections = new();
    private readonly object createGate = new();
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(12);
    private static readonly Dictionary<string, string[]> Decks = new()
    {
        ["fibonacci"] = ["0", "½", "1", "2", "3", "5", "8", "13", "21", "34", "55", "89", "?", "☕"],
        ["modified"] = ["0", "½", "1", "2", "3", "5", "8", "13", "20", "40", "100", "?", "☕"],
        ["tshirt"] = ["XS", "S", "M", "L", "XL", "XXL", "?", "☕"],
        ["powers"] = ["0", "1", "2", "4", "8", "16", "32", "64", "?", "☕"]
    };

    public RoomCredentials Create(CreateRoomRequest request)
    {
        var name = Text(request.Name, 80, "Session name", "Sprint planning");
        var playerName = Text(request.PlayerName, 40, "Your name", required: true);
        var deck = ValidDeck(request.Deck ?? "fibonacci");
        lock (createGate)
        {
            if (rooms.Count >= 1000) throw new RoomException("The server is at capacity. Please try again later.");
            var id = Convert.ToHexString(RandomNumberGenerator.GetBytes(4));
            while (rooms.ContainsKey(id)) id = Convert.ToHexString(RandomNumberGenerator.GetBytes(4));
            var room = new Room { Id = id, Name = name, Deck = deck, AutoReveal = request.AutoReveal };
            var host = new Member { Token = NewToken(), Name = playerName, IsHost = true };
            room.Members.Add(host.Id, host);
            rooms.TryAdd(id, room);
            return new(id, host.Token);
        }
    }

    public async Task<RoomCredentials> Join(JoinRequest request, string connectionId)
    {
        if (connections.ContainsKey(connectionId)) throw new RoomException("Leave your current session before joining another.");
        var id = (request.RoomId ?? "").Trim().ToUpperInvariant();
        if (!rooms.TryGetValue(id, out var room)) throw new RoomException("Session not found. Check the ID, or start a new session.");
        await room.Gate.WaitAsync();
        try
        {
            EnsureActive(room);
            var member = request.Token is not null ? room.Members.Values.FirstOrDefault(m => m.Token == request.Token) : null;
            if (request.Token is not null && member is null)
                throw new RoomException("Your place in this session has expired. Rejoin with your name.");
            if (member is null)
            {
                if (room.Members.Count >= 50) throw new RoomException("This session is full (50 participants).");
                member = new Member { Token = NewToken(), Name = Text(request.Name, 40, "Your name", required: true), Spectator = request.Spectator };
                room.Members.Add(member.Id, member);
            }
            member.Connections.Add(connectionId);
            connections[connectionId] = (room.Id, member.Id);
            // Return moderation to a reconnecting original host only if no host remains.
            if (!room.Members.Values.Any(m => m.IsHost && m.Connections.Count > 0))
            {
                foreach (var other in room.Members.Values) other.IsHost = other == member;
            }
            Touch(room);
            await Broadcast(room);
            return new(room.Id, member.Token);
        }
        finally { room.Gate.Release(); }
    }

    internal async Task Act(string connectionId, Action<Room, Member> action)
    {
        if (!connections.TryGetValue(connectionId, out var identity) || !rooms.TryGetValue(identity.Room, out var room))
            throw new RoomException("Join a session first.");
        await room.Gate.WaitAsync();
        try
        {
            EnsureActive(room);
            if (!room.Members.TryGetValue(identity.Member, out var member) || !member.Connections.Contains(connectionId))
                throw new RoomException("Your session has ended. Please rejoin.");
            action(room, member);
            Touch(room);
            await Broadcast(room);
        }
        finally { room.Gate.Release(); }
    }

    public async Task Disconnect(string connectionId, bool leave)
    {
        if (!connections.TryRemove(connectionId, out var identity) || !rooms.TryGetValue(identity.Room, out var room)) return;
        await room.Gate.WaitAsync();
        try
        {
            if (!room.Members.TryGetValue(identity.Member, out var member)) return;
            member.Connections.Remove(connectionId);
            // An explicit leave removes the identity only when its final tab leaves.
            if (leave && member.Connections.Count == 0) room.Members.Remove(member.Id);
            if (member.IsHost && member.Connections.Count == 0)
            {
                var next = room.Members.Values.FirstOrDefault(m => m.Connections.Count > 0);
                if (next is not null) { member.IsHost = false; next.IsHost = true; }
            }
            TryAutoReveal(room);
            Touch(room);
            await Broadcast(room);
        }
        finally { room.Gate.Release(); }
    }

    internal void Vote(Room room, Member member, string? value)
    {
        if (member.Spectator) throw new RoomException("Spectators cannot vote. Switch to player mode first.");
        if (room.Revealed) throw new RoomException("This round is revealed. Ask the host to start another round.");
        if (value is not null && !Decks[room.Deck].Contains(value)) throw new RoomException("Choose a card from the current deck.");
        member.Vote = value;
        TryAutoReveal(room);
    }

    internal void NextRound(Room room, Member member, string? topic)
    {
        Host(member);
        var nextTopic = Text(topic, 180, "Topic");
        if (room.Members.Values.Any(m => m.Vote is not null) && !room.Revealed)
            throw new RoomException("Reveal or reset the current votes before moving to a new round.");
        room.RoundNumber++;
        room.Topic = nextTopic;
        Reset(room);
    }

    internal void Settings(Room room, Member member, RoomSettings settings)
    {
        Host(member);
        var name = Text(settings.Name, 80, "Session name", required: true);
        var deck = ValidDeck(settings.Deck);
        if (deck != room.Deck && (room.Revealed || room.Members.Values.Any(m => m.Vote is not null)))
            throw new RoomException("Reset the round before changing decks.");
        room.Name = name;
        room.Deck = deck;
        room.AutoReveal = settings.AutoReveal;
        TryAutoReveal(room);
    }

    internal static void TryAutoReveal(Room room)
    {
        var players = room.Members.Values.Where(m => !m.Spectator && m.Connections.Count > 0).ToArray();
        if (room.AutoReveal && !room.Revealed && players.Length > 0 && players.All(m => m.Vote is not null)) Reveal(room);
    }

    internal static void Reveal(Room room)
    {
        if (room.Revealed) return;
        var votes = room.Members.Values.Where(m => !m.Spectator && m.Vote is not null).Select(m => m.Vote!).ToArray();
        if (votes.Length == 0) throw new RoomException("Play at least one card before revealing.");
        room.Revealed = true;
        room.TimerEndsAt = null;
        var distribution = votes.GroupBy(v => v).OrderBy(g => Array.IndexOf(Decks[room.Deck], g.Key))
            .Select(g => new ResultView(g.Key, g.Count())).ToArray();
        var numbers = votes.Select(v => v == "½" ? 0.5 : double.TryParse(v, CultureInfo.InvariantCulture, out var n) ? n : (double?)null)
            .Where(n => n.HasValue).Select(n => n!.Value).Order().ToArray();
        double? median = numbers.Length == 0 ? null : numbers.Length % 2 == 1 ? numbers[numbers.Length / 2] : (numbers[numbers.Length / 2 - 1] + numbers[numbers.Length / 2]) / 2;
        // Revoting replaces this round's result rather than duplicating history.
        room.History.RemoveAll(r => r.Number == room.RoundNumber);
        room.History.Add(new(room.RoundNumber, room.Topic, room.Deck, DateTimeOffset.UtcNow, distribution,
            numbers.Length == 0 ? null : Math.Round(numbers.Average(), 2), median, distribution.Length == 1 ? distribution[0].Value : null));
        if (room.History.Count > 100) room.History.RemoveAt(0);
    }

    internal static void Reset(Room room)
    {
        room.Revealed = false;
        room.TimerEndsAt = null;
        foreach (var member in room.Members.Values) member.Vote = null;
        room.History.RemoveAll(r => r.Number == room.RoundNumber);
    }

    internal static void Host(Member member)
    {
        if (!member.IsHost) throw new RoomException("Only the session host can do that.");
    }

    internal static string Text(string? value, int max, string label, string fallback = "", bool required = false)
    {
        var text = value?.Trim() ?? "";
        if (text.Length > max || text.Any(char.IsControl)) throw new RoomException($"{label} must be at most {max} characters without control characters.");
        if (required && text.Length == 0) throw new RoomException($"{label} is required.");
        return text.Length == 0 ? fallback : text;
    }

    private static string ValidDeck(string? value) => value is not null && Decks.ContainsKey(value) ? value : throw new RoomException("Choose a valid card deck.");
    private static string NewToken() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    private static void Touch(Room room) { room.LastActivity = DateTimeOffset.UtcNow; room.Version++; }
    private static void EnsureActive(Room room)
    {
        if (room.Deleted || room.LastActivity + Lifetime < DateTimeOffset.UtcNow)
            throw new RoomException("This session has expired. Start a new session.");
    }

    private Task Broadcast(Room room) => Task.WhenAll(room.Members.Values.Where(m => m.Connections.Count > 0).Select(member =>
        hub.Clients.Clients(member.Connections.ToArray()).SendAsync("RoomUpdated", new RoomView(
            room.Id, room.Name, room.Deck, Decks[room.Deck], room.AutoReveal, room.RoundNumber, room.Topic, room.Revealed, member.Id,
            room.Members.Values.Select(m => new MemberView(m.Id, m.Name, m.IsHost, m.Spectator, m.Connections.Count > 0,
                m.Vote is not null, room.Revealed || m == member ? m.Vote : null)).ToArray(), room.History.ToArray(),
            room.TimerEndsAt, room.LastActivity + Lifetime, room.Version))));

    public async Task Cleanup(CancellationToken cancellationToken)
    {
        foreach (var room in rooms.Values)
        {
            await room.Gate.WaitAsync(cancellationToken);
            try
            {
                if (room.LastActivity + Lifetime >= DateTimeOffset.UtcNow) continue;
                room.Deleted = true;
                rooms.TryRemove(room.Id, out _);
                foreach (var member in room.Members.Values)
                foreach (var connection in member.Connections)
                {
                    connections.TryRemove(connection, out _);
                    await hub.Clients.Client(connection).SendAsync("RoomExpired", cancellationToken);
                }
            }
            finally { room.Gate.Release(); }
        }
    }
}

public sealed class RoomCleanup(RoomStore rooms, ILogger<RoomCleanup> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken)) await rooms.Cleanup(stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        catch (Exception ex) { logger.LogError(ex, "Room cleanup failed"); throw; }
    }
}
