/**
 * Build TCP probe targets from a config tab's draft values. Shared by the
 * settings page (collect what the operator sees) and the test-connection
 * endpoint (shape only). Hosts are left unvalidated here — the endpoint
 * reports invalid targets as failed results so the UI can show why.
 */
export interface ConnTarget {
  label: string;
  host: string;
  port: number;
}

// The Impinj hardware speaks LLRP on a fixed port (5084); socket_port in the
// reader config is what the local gateway process listens on, so it must not
// be used when probing the hardware itself.
export const READER_LLRP_PORT = 5084;

export interface ConnResult extends ConnTarget {
  ok: boolean;
  ms?: number;
  error?: string;
}

export function buildTargets(file: string, draft: any): ConnTarget[] {
  const flat = draft?.[''] ?? {};
  const out: ConnTarget[] = [];
  if (file === 'reader') {
    out.push({
      label: 'Reader (speedway)',
      host: String(flat.speedway_address ?? ''),
      port: READER_LLRP_PORT
    });
  } else if (file === 'cameras') {
    const rows: any[] = Array.isArray(draft?.ipcame) ? draft.ipcame : [];
    rows.forEach((row, i) => {
      out.push({
        label: `Camera ${i + 1}`,
        host: String(row?.IP_CAMERA_ADDRESS ?? ''),
        port: Number(row?.RTSP_PORT ?? 554)
      });
    });
  } else if (file === 'gate') {
    out.push({
      label: 'Reader link',
      host: String(flat.socket_address ?? ''),
      port: Number(flat.socket_port ?? 11000)
    });
    const gates: any[] = Array.isArray(draft?.gates) ? draft.gates : [];
    gates.forEach((row, i) => {
      out.push({
        label: `Camera service (gate ${row?.gate_id ?? i + 1})`,
        host: String(row?.ipcame_gateway_address ?? ''),
        port: Number(row?.ipcame_port ?? 5555)
      });
    });
  }
  return out;
}
