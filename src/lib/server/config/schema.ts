import path from 'node:path';
import type Database from 'better-sqlite3';
import { getProjectPath, resolveProjectFile } from '../settings';

export type ConfigFile = 'reader' | 'cameras' | 'gate';
export type FieldType =
  | 'string' | 'number' | 'boolean' | 'enum' | 'array<object>' | 'array<number>';

export interface Field {
  key: string;
  label: string;
  help?: string;
  type: FieldType | string;
  enum?: { value: string | number; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  default?: unknown;
  secret?: boolean;
}

export interface Section {
  /**
   * Raw toml table name. The empty string marks a FLAT section: its fields live
   * at the top level of the document. The shipped reader, cameras and gate
   * configs are all flat except [filter] and the array tables.
   */
  key: string;
  label: string;
  fields: Field[];
  isArray?: boolean;
}

export interface ConfigSchema {
  key: ConfigFile;
  label: string;
  relPath: string;
  root: Section[];
}

const RF_MODE_VALUES: { value: number; label: string }[] = [
  { value: 0, label: 'Max Throughput' },
  { value: 1, label: 'Hybrid' },
  { value: 2, label: 'Dense Reader M4' },
  { value: 3, label: 'Dense Reader M8' },
  { value: 4, label: 'Max Miller' },
  { value: 5, label: 'Dense Reader M4 Two' },
  { value: 1000, label: 'Auto Set Dense Reader' },
  { value: 1002, label: 'Auto Set Dense Reader Deep Scan' },
  { value: 1003, label: 'Auto Set Static Fast' },
  { value: 1004, label: 'Auto Set Static DRM' },
  { value: 1005, label: 'Auto Set Custom / Impinj Internal' }
];

const SEARCH_MODE_VALUES = [
  'DualTarget', 'SingleTarget', 'ReaderSelected',
  'TagFocus', 'SingleTargetReset', 'DualTargetBtoASelect'
].map((v) => ({ value: v, label: v.replace(/([A-Z])/g, ' $1').trim() }));

// The shipped rfid config stores search_mode as a number:
// 1 = single target, 2 = dual target.
const GATE_SEARCH_MODE_VALUES: { value: number; label: string }[] = [
  { value: 1, label: 'Single target' },
  { value: 2, label: 'Dual target' }
];

const READER: ConfigSchema = {
  key: 'reader',
  label: 'Reader',
  relPath: 'config.toml',
  root: [
    {
      key: '',
      label: 'Reader',
      fields: [
        { key: 'reader_name', label: 'Reader name', type: 'string', default: 'My Reader' },
        { key: 'speedway_address', label: 'Reader IP address', help: 'IP of the Impinj Speedway reader.', type: 'string' },
        { key: 'socket_port', label: 'Socket port', help: 'Port the local reader gateway listens on for the gate service. Default 11000.', type: 'number', min: 1, max: 65535, default: 11000 },
        { key: 'session', label: 'Session', help: 'Impinj session (0–3). Default 1.', type: 'number', min: 0, max: 3, default: 1 },
        { key: 'tag_population', label: 'Tag population', help: 'Expected number of tags in range.', type: 'number', min: 1, default: 20 },
        { key: 'rf_mode', label: 'RF mode', help: 'Reader radio mode. Affects read rate and interference.', type: 'enum', enum: RF_MODE_VALUES, default: 2 },
        { key: 'selected_search_mode', label: 'Tag search mode', help: 'Impinj tag search mode.', type: 'enum', enum: SEARCH_MODE_VALUES, default: 'DualTarget' }
      ]
    },
    {
      key: 'filter',
      label: 'Tag filter',
      fields: [
        { key: 'enabled', label: 'Filter enabled', type: 'boolean', default: false },
        { key: 'tag_mask', label: 'Tag mask', help: 'Hex mask applied when the filter is enabled.', type: 'string', default: '0000' },
        { key: 'bit_count', label: 'Mask bit count', type: 'number', min: 0, default: 16 }
      ]
    },
    {
      key: 'antennas',
      label: 'Antennas',
      isArray: true,
      fields: [
        { key: 'ant_id', label: 'Antenna #', type: 'number', min: 1, max: 4, default: 1 },
        { key: 'tx_power', label: 'Tx power (dBm)', help: 'Transmit power for this antenna.', type: 'number', step: 0.5, min: 0, max: 32.5, default: 30 },
        { key: 'rx_sensitivity', label: 'Rx sensitivity', type: 'number', step: 0.5, min: -80, max: 0, default: -70 },
        { key: 'enable', label: 'Enabled', type: 'boolean', default: true }
      ]
    }
  ]
};

const CAMERAS: ConfigSchema = {
  key: 'cameras',
  label: 'Cameras',
  relPath: path.join('ipcame', 'config.toml'),
  root: [
    {
      key: '',
      label: 'Service',
      fields: [
        { key: 'SERVICE_PORT', label: 'Service port', type: 'number', min: 1, max: 65535, default: 5555 },
        { key: 'SAVE_CAMERA_IMAGE_DIR_NAME', label: 'Image save folder', type: 'string', default: 'images' },
        { key: 'image_width', label: 'Image width', type: 'number', min: 1, default: 1280 },
        { key: 'image_height', label: 'Image height', type: 'number', min: 1, default: 780 },
        {
          key: 'rotate', label: 'Image rotation', type: 'enum', default: 'ROTATE_180',
          enum: [
            { value: 'ROTATE_90_CLOCKWISE', label: 'Rotate 90° clockwise' },
            { value: 'ROTATE_180', label: 'Rotate 180°' },
            { value: 'ROTATE_90_COUNTERCLOCKWISE', label: 'Rotate 90° counter-clockwise' }
          ]
        }
      ]
    },
    {
      key: 'ipcame',
      label: 'IP cameras',
      isArray: true,
      fields: [
        { key: 'IP_CAMERA_ADDRESS', label: 'Camera IP address', type: 'string' },
        { key: 'RTSP_PORT', label: 'RTSP port', type: 'number', min: 1, max: 65535, default: 554 },
        { key: 'IP_CAMERA_USER', label: 'Camera user', type: 'string' },
        { key: 'IP_CAMERA_PASSWORD', label: 'Camera password', type: 'string', secret: true },
        { key: 'IP_CAMERA_CHANNEL', label: 'Camera channel', help: '101 = main stream, 102 = sub stream.', type: 'number', default: 101 },
        { key: 'relate_gate_id', label: 'Related gate ID', type: 'number', default: 10001 }
      ]
    }
  ]
};

const GATE: ConfigSchema = {
  key: 'gate',
  label: 'Gate RFID',
  relPath: path.join('rfid', 'config', 'config.toml'),
  root: [
    {
      // The shipped rfid/config/config.toml is entirely flat: reader link, MQTT
      // and behaviour keys all live at the top level of the document.
      key: '',
      label: 'Gate RFID',
      fields: [
        { key: 'socket_address', label: 'Reader socket address', help: 'Must match what the reader service listens on.', type: 'string', default: 'localhost' },
        { key: 'socket_port', label: 'Reader socket port', help: 'Must equal the Reader tab socket port (default 11000).', type: 'number', min: 1, max: 65535, default: 11000 },
        { key: 'tx_power', label: 'Tx power', type: 'number', min: 0, max: 32.5, default: 17 },
        { key: 'receiver_sensitivity_index', label: 'Receiver sensitivity index', type: 'number', min: 0, default: 2 },
        { key: 'mqtt_broker_address', label: 'MQTT broker address', type: 'string' },
        { key: 'mqtt_user', label: 'MQTT user', type: 'string' },
        { key: 'mqtt_passwd', label: 'MQTT password', type: 'string', secret: true },
        { key: 'cleanup_interval', label: 'Cleanup interval', help: 'Seconds between expired-tag sweeps.', type: 'number', min: 1, default: 2 },
        { key: 'report_every_n_tags', label: 'Report every N tags', type: 'number', min: 1, default: 1 },
        { key: 'search_mode', label: 'Search mode', help: '1 = single target, 2 = dual target.', type: 'enum', enum: GATE_SEARCH_MODE_VALUES, default: 2 },
        { key: 'tag_timeout', label: 'Tag timeout', help: 'Seconds before a tag is considered gone.', type: 'number', min: 1, default: 3 },
        { key: 'tag_population', label: 'Tag population', type: 'number', min: 1, default: 32 },
        { key: 'event_id', label: 'Event ID', type: 'number' }
      ]
    },
    {
      key: 'gates',
      label: 'Gates',
      isArray: true,
      fields: [
        { key: 'gate_id', label: 'Gate ID', type: 'string' },
        { key: 'ant', label: 'Antennas', help: 'Comma-separated antenna numbers, e.g. 1, 2.', type: 'array<number>', default: [] },
        { key: 'ipcame_gateway_address', label: 'Camera service address', type: 'string' },
        { key: 'ipcame_port', label: 'Camera service port', type: 'number', min: 1, max: 65535, default: 5555 },
        { key: 'camera_id', label: 'Camera ID', type: 'number' }
      ]
    }
  ]
};

export const CONFIG_FILES: ConfigFile[] = ['reader', 'cameras', 'gate'];

export const SCHEMAS: Record<ConfigFile, ConfigSchema> = {
  reader: READER,
  cameras: CAMERAS,
  gate: GATE
};

export function getField(schema: ConfigSchema, sectionKey: string, fieldKey: string): Field | undefined {
  return schema.root.find((s) => s.key === sectionKey)?.fields.find((f) => f.key === fieldKey);
}

export function fileFor(db: Database.Database, projectPath: string, key: ConfigFile): string {
  return resolveProjectFile(projectPath, SCHEMAS[key].relPath);
}
