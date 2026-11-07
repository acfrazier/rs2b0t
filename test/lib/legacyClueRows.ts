/* eslint-disable quotes */
/**
 * Why: these are clue rows of the 289 cluedb (rs2b0t `4501e63a`) that the 377 trail does not sell; tests of executor logic that is keyed on those ids inject them so the logic stays exercised.
 * Not 377 content: an id the 377 cluedb already carries is never overwritten, and `installLegacyClueRows` removes every injected row again.
 */
import { CASKET_IDS, CLUE_DB } from '#/bot/api/ai/clues/data/cluedb.js';
import type { ClueRow } from '#/bot/api/ai/clues/types.js';

const LEGACY_ROWS: Record<number, ClueRow> = {
    2858: {"obj":"trail_clue_medium_anagram012","id":2858,"type":"talk","npc":"Luthas"},
    3490: {"obj":"trail_clue_easy_vague006","id":3490,"type":"search","coord":{"x":2929,"z":3570,"level":0}},
    3491: {"obj":"trail_clue_easy_vague007","id":3491,"type":"search","coord":{"x":2598,"z":3105,"level":0}},
    3492: {"obj":"trail_clue_easy_vague008","id":3492,"type":"search","coord":{"x":2570,"z":3085,"level":0}},
    3493: {"obj":"trail_clue_easy_vague009","id":3493,"type":"search","coord":{"x":3000,"z":9798,"level":0}},
    3494: {"obj":"trail_clue_easy_vague010","id":3494,"type":"search","coord":{"x":2970,"z":3214,"level":1}},
    3495: {"obj":"trail_clue_easy_vague011","id":3495,"type":"search","coord":{"x":3016,"z":3205,"level":1}},
    3496: {"obj":"trail_clue_easy_vague012","id":3496,"type":"talk","npc":"Captain Tobias"},
    3497: {"obj":"trail_clue_easy_vague013","id":3497,"type":"search","coord":{"x":3041,"z":3364,"level":1}},
    3498: {"obj":"trail_clue_easy_vague014","id":3498,"type":"search","coord":{"x":3035,"z":3347,"level":1}},
    3499: {"obj":"trail_clue_easy_vague015","id":3499,"type":"search","coord":{"x":2886,"z":3449,"level":0}},
    3500: {"obj":"trail_clue_easy_vague016","id":3500,"type":"search","coord":{"x":2894,"z":3418,"level":0}},
    3501: {"obj":"trail_clue_easy_vague017","id":3501,"type":"search","coord":{"x":3308,"z":3206,"level":0}},
    3502: {"obj":"trail_clue_easy_vague018","id":3502,"type":"search","coord":{"x":3106,"z":3369,"level":2}},
    3503: {"obj":"trail_clue_easy_vague019","id":3503,"type":"search","coord":{"x":2885,"z":3540,"level":0}},
    3504: {"obj":"trail_clue_easy_vague020","id":3504,"type":"search","coord":{"x":2660,"z":3149,"level":0}},
    3505: {"obj":"trail_clue_easy_vague021","id":3505,"type":"search","coord":{"x":2657,"z":3322,"level":1}},
    3506: {"obj":"trail_clue_easy_vague022","id":3506,"type":"search","coord":{"x":2636,"z":3453,"level":0}},
    3507: {"obj":"trail_clue_easy_vague023","id":3507,"type":"search","coord":{"x":2809,"z":3451,"level":1}},
    3508: {"obj":"trail_clue_easy_vague024","id":3508,"type":"search","coord":{"x":2716,"z":3472,"level":1}},
    3509: {"obj":"trail_clue_easy_vague025","id":3509,"type":"search","coord":{"x":2699,"z":3470,"level":0}},
    3510: {"obj":"trail_clue_easy_vague026","id":3510,"type":"dig","casketObj":"trail_clue_easy_vague026_casket","casketId":3511,"coord":{"x":2458,"z":3504,"level":0}},
    3512: {"obj":"trail_clue_easy_vague027","id":3512,"type":"search","coord":{"x":3097,"z":3277,"level":0}},
    3513: {"obj":"trail_clue_easy_vague028","id":3513,"type":"talk","npc":"Louisa"},
    3514: {"obj":"trail_clue_easy_vague029","id":3514,"type":"talk","npc":"Jeed"},
    3515: {"obj":"trail_clue_easy_vague030","id":3515,"type":"search","coord":{"x":3224,"z":3492,"level":0}},
    3516: {"obj":"trail_clue_easy_map004","id":3516,"type":"dig","casketObj":"trail_clue_easy_map004_casket","casketId":3517,"coord":{"x":2612,"z":3482,"level":0}},
    3518: {"obj":"trail_clue_easy_map005","id":3518,"type":"dig","casketObj":"trail_clue_easy_map005_casket","casketId":3519,"coord":{"x":3109,"z":3153,"level":0}},
    3520: {"obj":"trail_clue_hard_map002","id":3520,"type":"dig","casketObj":"trail_clue_hard_map002_casket","casketId":3521,"coord":{"x":2616,"z":3077,"level":0}},
    3522: {"obj":"trail_clue_hard_map003","id":3522,"type":"dig","casketObj":"trail_clue_hard_map003_casket","casketId":3523,"coord":{"x":2488,"z":3308,"level":0}},
    3524: {"obj":"trail_clue_hard_map004","id":3524,"type":"search","coord":{"x":2459,"z":3179,"level":0}},
    3525: {"obj":"trail_clue_hard_map005","id":3525,"type":"search","coord":{"x":3026,"z":3628,"level":0}},
    3526: {"obj":"trail_clue_hard_sextant014","id":3526,"type":"dig","casketObj":"trail_clue_hard_sextant014_casket","casketId":3527,"coord":{"x":2892,"z":3675,"level":0},"needsSextant":true,"guardian":"Saradomin Wizard"},
    3528: {"obj":"trail_clue_hard_sextant015","id":3528,"type":"dig","casketObj":"trail_clue_hard_sextant015_casket","casketId":3529,"coord":{"x":2853,"z":3690,"level":0},"needsSextant":true,"guardian":"Saradomin Wizard"},
    3530: {"obj":"trail_clue_hard_sextant016","id":3530,"type":"dig","casketObj":"trail_clue_hard_sextant016_casket","casketId":3531,"coord":{"x":2763,"z":2974,"level":0},"needsSextant":true,"guardian":"Saradomin Wizard"},
    3532: {"obj":"trail_clue_hard_sextant017","id":3532,"type":"dig","casketObj":"trail_clue_hard_sextant016_casket","casketId":3531,"coord":{"x":2775,"z":2891,"level":0},"needsSextant":true,"guardian":"Saradomin Wizard"},
    3534: {"obj":"trail_clue_hard_sextant018","id":3534,"type":"dig","casketObj":"trail_clue_hard_sextant018_casket","casketId":3535,"coord":{"x":2838,"z":2914,"level":0},"needsSextant":true,"guardian":"Saradomin Wizard"},
    3536: {"obj":"trail_clue_hard_sextant019","id":3536,"type":"dig","casketObj":"trail_clue_hard_sextant019_casket","casketId":3537,"coord":{"x":2950,"z":2902,"level":0},"needsSextant":true,"guardian":"Saradomin Wizard"},
    3538: {"obj":"trail_clue_hard_sextant020","id":3538,"type":"dig","casketObj":"trail_clue_hard_sextant020_casket","casketId":3539,"coord":{"x":2961,"z":3024,"level":0},"needsSextant":true,"guardian":"Saradomin Wizard"},
    3540: {"obj":"trail_clue_hard_sextant021","id":3540,"type":"dig","casketObj":"trail_clue_hard_sextant021_casket","casketId":3541,"coord":{"x":2924,"z":2963,"level":0},"needsSextant":true,"guardian":"Saradomin Wizard"},
    3542: {"obj":"trail_clue_hard_sextant022","id":3542,"type":"dig","casketObj":"trail_clue_hard_sextant022_casket","casketId":3543,"coord":{"x":3440,"z":3341,"level":0},"needsSextant":true,"guardian":"Saradomin Wizard"},
    3544: {"obj":"trail_clue_hard_sextant023","id":3544,"type":"dig","casketObj":"trail_clue_hard_sextant023_casket","casketId":3545,"coord":{"x":3441,"z":3419,"level":0},"needsSextant":true,"guardian":"Saradomin Wizard"},
    3546: {"obj":"trail_clue_hard_sextant024","id":3546,"type":"dig","casketObj":"trail_clue_hard_sextant024_casket","casketId":3547,"coord":{"x":2542,"z":3031,"level":0},"needsSextant":true,"guardian":"Saradomin Wizard"},
    3548: {"obj":"trail_clue_hard_sextant025","id":3548,"type":"dig","casketObj":"trail_clue_hard_sextant025_casket","casketId":3549,"coord":{"x":2581,"z":3030,"level":0},"needsSextant":true,"guardian":"Saradomin Wizard"},
    3552: {"obj":"trail_clue_hard_sextant027","id":3552,"type":"dig","casketObj":"trail_clue_hard_sextant027_casket","casketId":3553,"coord":{"x":3168,"z":3041,"level":0},"needsSextant":true,"guardian":"Saradomin Wizard"},
    3554: {"obj":"trail_clue_hard_sextant028","id":3554,"type":"dig","casketObj":"trail_clue_hard_sextant028_casket","casketId":3555,"coord":{"x":3374,"z":3250,"level":0},"needsSextant":true},
    3556: {"obj":"trail_clue_hard_sextant029","id":3556,"type":"dig","casketObj":"trail_clue_hard_sextant029_casket","casketId":3557,"coord":{"x":3094,"z":3764,"level":0},"needsSextant":true,"guardian":"Zamorak Wizard"},
    3558: {"obj":"trail_clue_hard_sextant030","id":3558,"type":"dig","casketObj":"trail_clue_hard_sextant030_casket","casketId":3559,"coord":{"x":3285,"z":3942,"level":0},"needsSextant":true,"guardian":"Zamorak Wizard"},
    3560: {"obj":"trail_clue_hard_sextant031","id":3560,"type":"dig","casketObj":"trail_clue_hard_sextant031_casket","casketId":3561,"coord":{"x":2209,"z":3161,"level":0},"needsSextant":true,"guardian":"Saradomin Wizard"},
    3562: {"obj":"trail_clue_hard_sextant032","id":3562,"type":"dig","casketObj":"trail_clue_hard_sextant032_casket","casketId":3563,"coord":{"x":2181,"z":3206,"level":0},"needsSextant":true,"guardian":"Saradomin Wizard"},
    3564: {"obj":"trail_clue_hard_riddle018","id":3564,"type":"talk","npc":"Lord Iorwerth","puzzle":{"obj":"trail_clue_hard_riddle018_puzzlebox","id":3565}},
    3566: {"obj":"trail_clue_hard_riddle019","id":3566,"type":"talk","npc":"Examiner","puzzle":{"obj":"trail_clue_hard_riddle019_puzzlebox","id":3567}},
    3568: {"obj":"trail_clue_hard_riddle020","id":3568,"type":"talk","npc":"Hamid","puzzle":{"obj":"trail_clue_hard_riddle020_puzzlebox","id":3569}},
    3570: {"obj":"trail_clue_hard_riddle021","id":3570,"type":"talk","npc":"Gnome pilot","puzzle":{"obj":"trail_clue_hard_riddle021_puzzlebox","id":3571}},
    3572: {"obj":"trail_clue_hard_riddle022","id":3572,"type":"search","coord":{"x":2702,"z":3409,"level":1}},
    3573: {"obj":"trail_clue_hard_riddle023","id":3573,"type":"search","coord":{"x":2523,"z":3493,"level":1}},
    3574: {"obj":"trail_clue_hard_riddle024","id":3574,"type":"search","coord":{"x":2576,"z":3464,"level":0}},
    3575: {"obj":"trail_clue_hard_riddle025","id":3575,"type":"talk","npc":"Heckel Funch","puzzle":{"obj":"trail_clue_hard_riddle025_puzzlebox","id":3576}},
    3577: {"obj":"trail_clue_hard_riddle026","id":3577,"type":"talk","npc":"Gnome trainer","puzzle":{"obj":"trail_clue_hard_riddle026_puzzlebox","id":3578}},
    3579: {"obj":"trail_clue_hard_riddle027","id":3579,"type":"search","coord":{"x":2818,"z":3351,"level":0}},
    3580: {"obj":"trail_clue_hard_riddle028","id":3580,"type":"dig","casketObj":"trail_clue_hard_riddle028_casket","casketId":3581,"coord":{"x":2832,"z":9586,"level":0}},
    3582: {"obj":"trail_clue_medium_sextant014","id":3582,"type":"dig","casketObj":"trail_clue_medium_sextant014_casket","casketId":3583,"coord":{"x":3443,"z":3515,"level":0},"needsSextant":true},
    3584: {"obj":"trail_clue_medium_sextant015","id":3584,"type":"dig","casketObj":"trail_clue_medium_sextant015_casket","casketId":3585,"coord":{"x":3430,"z":3388,"level":0},"needsSextant":true},
    3586: {"obj":"trail_clue_medium_sextant016","id":3586,"type":"dig","casketObj":"trail_clue_medium_sextant016_casket","casketId":3587,"coord":{"x":2919,"z":3535,"level":0},"needsSextant":true},
    3588: {"obj":"trail_clue_medium_sextant017","id":3588,"type":"dig","casketObj":"trail_clue_medium_sextant017_casket","casketId":3589,"coord":{"x":2887,"z":3154,"level":0},"needsSextant":true},
    3590: {"obj":"trail_clue_medium_sextant018","id":3590,"type":"dig","casketObj":"trail_clue_medium_sextant018_casket","casketId":3591,"coord":{"x":2743,"z":3151,"level":0},"needsSextant":true},
    3592: {"obj":"trail_clue_medium_sextant019","id":3592,"type":"dig","casketObj":"trail_clue_medium_sextant019_casket","casketId":3593,"coord":{"x":2387,"z":3435,"level":0},"needsSextant":true},
    3594: {"obj":"trail_clue_medium_sextant020","id":3594,"type":"dig","casketObj":"trail_clue_medium_sextant020_casket","casketId":3595,"coord":{"x":2416,"z":3516,"level":0},"needsSextant":true},
    3596: {"obj":"trail_clue_medium_map003","id":3596,"type":"dig","casketObj":"trail_clue_medium_map003_casket","casketId":3597,"coord":{"x":2907,"z":3295,"level":0}},
    3598: {"obj":"trail_clue_medium_map004","id":3598,"type":"search","coord":{"x":2658,"z":3488,"level":0}},
    3599: {"obj":"trail_clue_medium_map005","id":3599,"type":"dig","casketObj":"trail_clue_medium_map005_casket","casketId":3600,"coord":{"x":2650,"z":3231,"level":0}},
    3601: {"obj":"trail_clue_medium_map006","id":3601,"type":"search","coord":{"x":2565,"z":3248,"level":0}},
    3602: {"obj":"trail_clue_medium_map007","id":3602,"type":"dig","casketObj":"trail_clue_medium_map007_casket","casketId":3603,"coord":{"x":2924,"z":3209,"level":0}},
    3604: {"obj":"trail_clue_medium_riddle006","id":3604,"type":"search","coord":{"x":2800,"z":3074,"level":0}},
    3605: {"obj":"trail_clue_medium_riddle007","id":3605,"type":"search","coord":{"x":2809,"z":3165,"level":1},"keyFrom":{"npc":"pirate","keyObj":"trail_clue_medium_riddle007_key","keyId":3606}},
    3607: {"obj":"trail_clue_medium_riddle008","id":3607,"type":"search","coord":{"x":2921,"z":3577,"level":0},"keyFrom":{"npc":"Penda","keyObj":"trail_clue_medium_riddle008_key","keyId":3608}},
    3609: {"obj":"trail_clue_medium_riddle009","id":3609,"type":"search","coord":{"x":3498,"z":3507,"level":0}},
    3610: {"obj":"trail_clue_medium_riddle010","id":3610,"type":"search","coord":{"x":2614,"z":3204,"level":0}},
    3611: {"obj":"trail_clue_medium_anagram013","id":3611,"type":"talk","npc":"Femi"},
    3612: {"obj":"trail_clue_medium_anagram014","id":3612,"type":"talk","npc":"Brimstail"},
    3613: {"obj":"trail_clue_medium_anagram015","id":3613,"type":"talk","npc":"Saba"},
    3614: {"obj":"trail_clue_medium_anagram016","id":3614,"type":"talk","npc":"Ulizius"},
    3615: {"obj":"trail_clue_medium_anagram017","id":3615,"type":"talk","npc":"Roavar"},
    3616: {"obj":"trail_clue_medium_anagram018","id":3616,"type":"talk","npc":"Jaraah"},
    3617: {"obj":"trail_clue_medium_anagram019","id":3617,"type":"talk","npc":"Kangai Mau"},
};

const LEGACY_CASKETS: Record<number, string> = {
    3511: "trail_clue_easy_vague026_casket",
    3517: "trail_clue_easy_map004_casket",
    3519: "trail_clue_easy_map005_casket",
    3521: "trail_clue_hard_map002_casket",
    3523: "trail_clue_hard_map003_casket",
    3527: "trail_clue_hard_sextant014_casket",
    3529: "trail_clue_hard_sextant015_casket",
    3531: "trail_clue_hard_sextant016_casket",
    3535: "trail_clue_hard_sextant018_casket",
    3537: "trail_clue_hard_sextant019_casket",
    3539: "trail_clue_hard_sextant020_casket",
    3541: "trail_clue_hard_sextant021_casket",
    3543: "trail_clue_hard_sextant022_casket",
    3545: "trail_clue_hard_sextant023_casket",
    3547: "trail_clue_hard_sextant024_casket",
    3549: "trail_clue_hard_sextant025_casket",
    3553: "trail_clue_hard_sextant027_casket",
    3555: "trail_clue_hard_sextant028_casket",
    3557: "trail_clue_hard_sextant029_casket",
    3559: "trail_clue_hard_sextant030_casket",
    3561: "trail_clue_hard_sextant031_casket",
    3563: "trail_clue_hard_sextant032_casket",
    3581: "trail_clue_hard_riddle028_casket",
    3583: "trail_clue_medium_sextant014_casket",
    3585: "trail_clue_medium_sextant015_casket",
    3587: "trail_clue_medium_sextant016_casket",
    3589: "trail_clue_medium_sextant017_casket",
    3591: "trail_clue_medium_sextant018_casket",
    3593: "trail_clue_medium_sextant019_casket",
    3595: "trail_clue_medium_sextant020_casket",
    3597: "trail_clue_medium_map003_casket",
    3600: "trail_clue_medium_map005_casket",
    3603: "trail_clue_medium_map007_casket",
};

/** Inject the legacy rows the 377 cluedb lacks; call the returned function to restore the 377 table. */
export function installLegacyClueRows(): () => void {
    const addedRows: number[] = [];
    const addedCaskets: number[] = [];
    for (const [id, row] of Object.entries(LEGACY_ROWS)) {
        if (CLUE_DB[Number(id)] === undefined) {
            CLUE_DB[Number(id)] = row;
            addedRows.push(Number(id));
        }
    }
    for (const [id, obj] of Object.entries(LEGACY_CASKETS)) {
        if (CASKET_IDS[Number(id)] === undefined) {
            CASKET_IDS[Number(id)] = obj;
            addedCaskets.push(Number(id));
        }
    }
    return () => {
        for (const id of addedRows) delete CLUE_DB[id];
        for (const id of addedCaskets) delete CASKET_IDS[id];
    };
}
