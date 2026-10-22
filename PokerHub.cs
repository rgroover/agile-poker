using Microsoft.AspNetCore.SignalR;

namespace AgilePoker;

public sealed class PokerHub(RoomStore rooms) : Hub
{
    public Task<RoomCredentials> Join(JoinRequest request) => Safe(() => rooms.Join(request, Context.ConnectionId));
    public Task Vote(string? value) => Act((room, member) => rooms.Vote(room, member, value));
    public Task Reveal() => Act((room, member) => { RoomStore.Host(member); RoomStore.Reveal(room); });
    public Task RestartRound() => Act((room, member) => { RoomStore.Host(member); RoomStore.Reset(room); });
    public Task NextRound(string? topic) => Act((room, member) => rooms.NextRound(room, member, topic));
    public Task SetTopic(string? topic) => Act((room, member) =>
    {
        RoomStore.Host(member);
        if (room.Revealed || room.Members.Values.Any(m => m.Vote is not null))
            throw new RoomException("Start a new round to change the topic after voting begins.");
        room.Topic = RoomStore.Text(topic, 180, "Topic");
    });
    public Task UpdateSettings(RoomSettings settings) => Act((room, member) => rooms.Settings(room, member, settings));
    public Task SetSpectator(bool spectator) => Act((room, member) =>
    {
        if (room.Revealed) throw new RoomException("Change your role when the next round starts.");
        member.Spectator = spectator;
        member.Vote = null;
        RoomStore.TryAutoReveal(room);
    });
    public Task SetTimer(int seconds) => Act((room, member) =>
    {
        RoomStore.Host(member);
        if (seconds is not (0 or 60 or 120 or 300)) throw new RoomException("Choose a valid timer duration.");
        room.TimerEndsAt = seconds == 0 ? null : DateTimeOffset.UtcNow.AddSeconds(seconds);
    });
    public Task Leave() => Safe(() => rooms.Disconnect(Context.ConnectionId, true));
    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await rooms.Disconnect(Context.ConnectionId, false);
        await base.OnDisconnectedAsync(exception);
    }

    private Task Act(Action<Room, Member> action) => Safe(() => rooms.Act(Context.ConnectionId, action));
    private static async Task Safe(Func<Task> action)
    {
        try { await action(); }
        catch (RoomException ex) { throw new HubException(ex.Message); }
    }
    private static async Task<T> Safe<T>(Func<Task<T>> action)
    {
        try { return await action(); }
        catch (RoomException ex) { throw new HubException(ex.Message); }
    }
}
