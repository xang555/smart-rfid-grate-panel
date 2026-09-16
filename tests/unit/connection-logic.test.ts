import { describe, it, expect } from 'vitest';
import { buildTargets } from '../../src/lib/connection-logic';

describe('buildTargets', () => {
  it('builds the reader target from the flat section', () => {
    const t = buildTargets('reader', { '': { speedway_address: '192.168.55.12', socket_port: 11000 } });
    expect(t).toEqual([{ label: 'Reader (speedway)', host: '192.168.55.12', port: 11000 }]);
  });

  it('builds one target per camera row', () => {
    const t = buildTargets('cameras', {
      '': {},
      ipcame: [
        { IP_CAMERA_ADDRESS: '192.168.1.64', RTSP_PORT: 554 },
        { IP_CAMERA_ADDRESS: '192.168.1.65', RTSP_PORT: 554 }
      ]
    });
    expect(t).toEqual([
      { label: 'Camera 1', host: '192.168.1.64', port: 554 },
      { label: 'Camera 2', host: '192.168.1.65', port: 554 }
    ]);
  });

  it('builds the reader link plus one target per gate row', () => {
    const t = buildTargets('gate', {
      '': { socket_address: 'localhost', socket_port: 11000 },
      gates: [{ gate_id: 'G1', ipcame_gateway_address: '127.0.0.1', ipcame_port: 5555 }]
    });
    expect(t).toEqual([
      { label: 'Reader link', host: 'localhost', port: 11000 },
      { label: 'Camera service (gate G1)', host: '127.0.0.1', port: 5555 }
    ]);
  });

  it('keeps rows without a host so the report can name them', () => {
    const t = buildTargets('gate', {
      '': { socket_address: 'localhost' },
      gates: [{ gate_id: 'G1' }, { gate_id: 'G2', ipcame_gateway_address: '10.0.0.3' }]
    });
    expect(t).toEqual([
      { label: 'Reader link', host: 'localhost', port: 11000 },
      { label: 'Camera service (gate G1)', host: '', port: 5555 },
      { label: 'Camera service (gate G2)', host: '10.0.0.3', port: 5555 }
    ]);
  });

  it('reader keeps its primary target even when unset (reported, not hidden)', () => {
    expect(buildTargets('reader', {})).toEqual([
      { label: 'Reader (speedway)', host: '', port: 11000 }
    ]);
    expect(buildTargets('cameras', { '': {}, ipcame: [] })).toEqual([]);
  });
});
