export default class Skill {
    static readonly count: number = 25;
    // 1:1 jagex2.client.Stats.field1504 / field1505 (Client-Java 377)
    static readonly names: string[] = [
        'attack',
        'defence',
        'strength',
        'hitpoints',
        'ranged',
        'prayer',
        'magic',
        'cooking',
        'woodcutting',
        'fletching',
        'fishing',
        'firemaking',
        'crafting',
        'smithing',
        'mining',
        'herblore',
        'agility',
        'thieving',
        'slayer',
        'farming',
        'runecraft',
        'yodelling',
        'hexediting',
        '-unused-',
        '-unused-'
    ];
    static readonly used: boolean[] = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, false, false, false, false];
}
