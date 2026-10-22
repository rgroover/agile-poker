namespace AgilePoker;

public sealed record CreateRoomRequest(string? Name, string? PlayerName, string? Deck, bool AutoReveal = false);
public sealed record RoomCredentials(string RoomId, string Token);
public sealed record JoinRequest(string RoomId, string? Token, string? Name, bool Spectator = false);
public sealed record RoomSettings(string? Name, string? Deck, bool AutoReveal);
public sealed record MemberView(string Id, string Name, bool IsHost, bool Spectator, bool Online, bool HasVoted, string? Vote);
public sealed record ResultView(string Value, int Count);
public sealed record RoundView(int Number, string Topic, string Deck, DateTimeOffset FinishedAt, ResultView[] Distribution, double? Average, double? Median, string? Consensus);
public sealed record RoomView(string Id, string Name, string Deck, string[] Cards, bool AutoReveal, int Round,
    string Topic, bool Revealed, string You, MemberView[] Members, RoundView[] History,
    DateTimeOffset? TimerEndsAt, DateTimeOffset ExpiresAt, long Version);

internal sealed class Room
{
    public required string Id { get; init; }
    public required string Name { get; set; }
    public required string Deck { get; set; }
    public bool AutoReveal { get; set; }
    public SemaphoreSlim Gate { get; } = new(1, 1);
    public Dictionary<string, Member> Members { get; } = [];
    public List<RoundView> History { get; } = [];
    public int RoundNumber { get; set; } = 1;
    public string Topic { get; set; } = "";
    public bool Revealed { get; set; }
    public DateTimeOffset? TimerEndsAt { get; set; }
    public DateTimeOffset LastActivity { get; set; } = DateTimeOffset.UtcNow;
    public long Version { get; set; }
    public bool Deleted { get; set; }
}

internal sealed class Member
{
    public string Id { get; } = Guid.NewGuid().ToString("N");
    public required string Token { get; init; }
    public required string Name { get; set; }
    public bool IsHost { get; set; }
    public bool Spectator { get; set; }
    public string? Vote { get; set; }
    public HashSet<string> Connections { get; } = [];
}

public sealed class RoomException(string message) : Exception(message);
