import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { expect, test } from 'bun:test';

test('377 castle trapdoor Open derives its scripted cellar destination without changing 289', () => {
    const result = spawnSync('python3', ['-c', `
import importlib.util
import sys
from types import SimpleNamespace
from pathlib import Path

script = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("derive_ladders", script)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
config = SimpleNamespace(debug_name="trapdoor_14879", display_name="Trapdoor", options=["Open"])
assert not module.is_ladder_config(config, 289)
assert module.is_ladder_config(config, 377)
assert module.SCRIPTED_DUNGEON_OPS[config.debug_name] == 1
placement = module.EffectivePlacement(14879, 3209, 3216, 0, 10, 0)
stand = module.Target(3210, 3216, 0)
targets, reason = module.destinations(config.debug_name, "p_delay(0); p_telejump(0_50_150_9_17);", placement, stand)
assert reason is None
assert targets == [module.Target(3209, 9617, 0)]
edge = module.make_edge(SimpleNamespace(loc_id=14879, display_name="Trapdoor", debug_name=config.debug_name, options=config.options), placement, "Open", stand, targets[0], reason, 0)
assert edge["kind"] == "dungeon"
assert edge["locId"] == 14879
assert edge["action"] == "Open"
assert edge["extraTicks"] == 0
assert "disabledReason" not in edge
`, path.resolve('tools/nav/derive-ladders.py')], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
});

test('manhole enrichment resolves the scripted closed/open pair rather than disabling descent', () => {
    const result = spawnSync('python3', ['-c', `
import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("enrichment", Path(sys.argv[1]))
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
closed = module.LocConfig(881, "manholeclosed", "Manhole", ["Open"])
opened = module.LocConfig(882, "manholeopen", "Manhole", ["Climb-down"])
configs = {881: closed, 882: opened}
placement = module.Placement(881, 3237, 3458, 0, 10, 0)
edge = {"from": {"x": 3237, "z": 3459, "level": 0}, "to": {"x": 3237, "z": 9859, "level": 0}, "locName": "Manhole", "action": "Climb down", "kind": "dungeon"}
resolved = module.resolve_source_loc(edge, configs, {(3237, 3458, 0): [placement]}, set(), 377)
assert resolved == (opened, placement)
assert module.closed_open_loc_ids(configs, 881, opened) == (881, 882)
assert module.closed_open_loc_ids(configs, 882, opened) == (881, 882)
`, path.resolve('tools/nav/enrich-transports.py')], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
});
