export type ServiceName = 'reader' | 'ipcame' | 'rfid';
export type ServiceActual =
  | 'stopped'
  | 'pulling'   // docker only: pulling the image before up -d (spec 8.1)
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error';

export interface ServiceStatus {
  name: ServiceName;
  label: string;
  actual: ServiceActual;
  pid?: number;
  detail?: string;
  since?: number;
}

export interface ActionResult {
  ok: boolean;
  service?: ServiceName;
  code?: string;
  message: string;
  detail?: string;
}

export const SERVICE_ORDER: ServiceName[] = ['reader', 'ipcame', 'rfid'];

export const SERVICE_LABELS: Record<ServiceName, string> = {
  reader: 'Reader',
  ipcame: 'IP Camera',
  rfid: 'Gate RFID'
};

export const SERVICE_DEPS: Record<ServiceName, ServiceName[]> = {
  reader: [],
  ipcame: [],
  rfid: ['reader', 'ipcame']
};
