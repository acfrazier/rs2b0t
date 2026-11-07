export interface Client377State {
    fullscreenInterfaceId0: number;
    fullscreenInterfaceId1: number;
    chatbackInputOpen: number;
    currentDay: number;
    previousLoginDay: number;
    daysSincePasswordChanged: number;
    recoveriesLastChangedDay: number;
    daysOfMembersRemaining: number;
    modelRotateByComponentId: Map<number, number>;
}

const states = new WeakMap<object, Client377State>();

export function getClient377State(client: object): Client377State {
    let state = states.get(client);
    if (!state) {
        state = {
            fullscreenInterfaceId0: -1,
            fullscreenInterfaceId1: -1,
            chatbackInputOpen: 0,
            currentDay: 0,
            previousLoginDay: 0,
            daysSincePasswordChanged: 0,
            recoveriesLastChangedDay: 0,
            daysOfMembersRemaining: 0,
            modelRotateByComponentId: new Map()
        };
        states.set(client, state);
    }
    return state;
}
