/**
 * This file contains the class Matterbridge.
 *
 * @file matterbridge.ts
 * @author Luca Liguori
 * @date 2023-12-29
 * @version 1.3.2
 *
 * Copyright 2023, 2024 Luca Liguori.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License. *
 */

import { NodeStorageManager, NodeStorage } from 'node-persist-manager';
import { AnsiLogger, BRIGHT, RESET, TimestampFormat, UNDERLINE, UNDERLINEOFF, YELLOW, db, debugStringify, stringify, er, nf, rs, wr, RED, GREEN, zb, hk, or, idn, BLUE } from 'node-ansi-logger';
import { fileURLToPath, pathToFileURL } from 'url';
import { promises as fs } from 'fs';
import { ExecException, exec, spawn } from 'child_process';
import { Server, createServer } from 'http';
import * as http from 'http';
import https from 'https';
import EventEmitter from 'events';
import express from 'express';
import os from 'os';
import path from 'path';
import WebSocket, { WebSocketServer } from 'ws';

// Matterbridge
import { MatterbridgeDevice, SerializedMatterbridgeDevice } from './matterbridgeDevice.js';
import { MatterbridgePlatform, PlatformConfig, PlatformSchema } from './matterbridgePlatform.js';
import { shelly_config, somfytahoma_config, zigbee2mqtt_config } from './defaultConfigSchema.js';
import { BridgedDeviceBasicInformation, BridgedDeviceBasicInformationCluster } from './cluster/BridgedDeviceBasicInformationCluster.js';
import { logInterfaces } from './utils/utils.js';

// @project-chip/matter-node.js
import { CommissioningController, CommissioningServer, MatterServer, NodeCommissioningOptions } from '@project-chip/matter-node.js';
import { BasicInformationCluster, ClusterServer, FixedLabelCluster, GeneralCommissioning, PowerSourceCluster, SwitchCluster, ThreadNetworkDiagnosticsCluster, getClusterNameById } from '@project-chip/matter-node.js/cluster';
import { DeviceTypeId, EndpointNumber, FabricIndex, NodeId, VendorId } from '@project-chip/matter-node.js/datatype';
import { Aggregator, DeviceTypes, Endpoint, NodeStateInformation } from '@project-chip/matter-node.js/device';
import { Format, Level, Logger } from '@project-chip/matter-node.js/log';
import { ManualPairingCodeCodec, QrCodeSchema } from '@project-chip/matter-node.js/schema';
import { StorageBackendDisk, StorageBackendJsonFile, StorageContext, StorageManager } from '@project-chip/matter-node.js/storage';
import { requireMinNodeVersion, getParameter, getIntParameter, hasParameter } from '@project-chip/matter-node.js/util';
import { CryptoNode } from '@project-chip/matter-node.js/crypto';
import { CommissioningOptions } from '@project-chip/matter-node.js/protocol';
import { ExposedFabricInformation } from '@project-chip/matter-node.js/fabric';

// Define an interface for storing the plugins
export interface RegisteredPlugin extends BaseRegisteredPlugin {
  nodeContext?: NodeStorage;
  storageContext?: StorageContext;
  commissioningServer?: CommissioningServer;
  aggregator?: Aggregator;
  device?: MatterbridgeDevice;
  platform?: MatterbridgePlatform;
}

// Simplified interface for saving the plugins in node storage
export interface BaseRegisteredPlugin {
  path: string;
  type: string;
  name: string;
  version: string;
  description: string;
  author: string;
  latestVersion?: string;
  locked?: boolean;
  error?: boolean;
  enabled?: boolean;
  loaded?: boolean;
  started?: boolean;
  configured?: boolean;
  paired?: boolean;
  connected?: boolean;
  fabricInformations?: SanitizedExposedFabricInformation[];
  sessionInformations?: SanitizedSessionInformation[];
  registeredDevices?: number;
  addedDevices?: number;
  qrPairingCode?: string;
  manualPairingCode?: string;
  configJson?: PlatformConfig;
  schemaJson?: PlatformSchema;
}

// Define an interface for storing the devices
interface RegisteredDevice {
  plugin: string;
  device: MatterbridgeDevice;
}

// Define an interface for storing the system information
interface SystemInformation {
  interfaceName: string;
  macAddress: string;
  ipv4Address: string;
  ipv6Address: string;
  nodeVersion: string;
  hostname: string;
  user: string;
  osType: string;
  osRelease: string;
  osPlatform: string;
  osArch: string;
  totalMemory: string;
  freeMemory: string;
  systemUptime: string;
}

// Define an interface for storing the matterbridge information
interface MatterbridgeInformation {
  homeDirectory: string;
  rootDirectory: string;
  matterbridgeDirectory: string;
  matterbridgePluginDirectory: string;
  globalModulesDirectory: string;
  matterbridgeVersion: string;
  matterbridgeLatestVersion: string;
  matterbridgeFabricInformations: SanitizedExposedFabricInformation[];
  matterbridgeSessionInformations: SanitizedSessionInformation[];
  matterbridgePaired: boolean;
  matterbridgeConnected: boolean;
  bridgeMode: string;
  restartMode: string;
  debugEnabled: boolean;
  matterLoggerLevel: number;
}

interface SanitizedExposedFabricInformation {
  fabricIndex: FabricIndex;
  fabricId: string; // bigint > string
  nodeId: string; // bigint > string
  rootNodeId: string; // bigint > string
  rootVendorId: VendorId;
  rootVendorName: string;
  label: string;
}

interface SessionInformation {
  name: string;
  nodeId: NodeId;
  peerNodeId: NodeId;
  fabric?: ExposedFabricInformation;
  isPeerActive: boolean;
  secure: boolean;
  lastInteractionTimestamp?: number;
  lastActiveTimestamp?: number;
  numberOfActiveSubscriptions: number;
}

interface SanitizedSessionInformation {
  name: string;
  nodeId: string;
  peerNodeId: string;
  fabric?: SanitizedExposedFabricInformation;
  isPeerActive: boolean;
  secure: boolean;
  lastInteractionTimestamp?: number;
  lastActiveTimestamp?: number;
  numberOfActiveSubscriptions: number;
}

// Default colors
const plg = '\u001B[38;5;33m';
const dev = '\u001B[38;5;79m';
const typ = '\u001B[38;5;207m';

/**
 * Represents the Matterbridge application.
 */
export class Matterbridge extends EventEmitter {
  public systemInformation: SystemInformation = {
    interfaceName: '',
    macAddress: '',
    ipv4Address: '',
    ipv6Address: '',
    nodeVersion: '',
    hostname: '',
    user: '',
    osType: '',
    osRelease: '',
    osPlatform: '',
    osArch: '',
    totalMemory: '',
    freeMemory: '',
    systemUptime: '',
  };

  public matterbridgeInformation: MatterbridgeInformation = {
    homeDirectory: '',
    rootDirectory: '',
    matterbridgeDirectory: '',
    matterbridgePluginDirectory: '',
    globalModulesDirectory: '',
    matterbridgeVersion: '',
    matterbridgeLatestVersion: '',
    matterbridgeFabricInformations: [],
    matterbridgeSessionInformations: [],
    matterbridgePaired: false,
    matterbridgeConnected: false,
    bridgeMode: '',
    restartMode: '',
    debugEnabled: false,
    matterLoggerLevel: Level.INFO,
  };

  public homeDirectory = '';
  public rootDirectory = '';
  public matterbridgeDirectory = '';
  public matterbridgePluginDirectory = '';
  public globalModulesDirectory = '';
  public matterbridgeVersion = '';
  public matterbridgeLatestVersion = '';
  public matterbridgeFabricInformations: SanitizedExposedFabricInformation[] = [];
  public matterbridgePaired = false;
  public matterbridgeConnected = false;
  public matterbridgeSessionInformations: SanitizedSessionInformation[] = [];

  private checkUpdateInterval?: NodeJS.Timeout; // = 24 * 60 * 60 * 1000; // 24 hours

  public bridgeMode: 'bridge' | 'childbridge' | 'controller' | '' = '';
  public restartMode: 'service' | 'docker' | '' = '';
  public debugEnabled = false;

  private mdnsInterface: string | undefined; // matter server mdnsInterface: e.g. 'eth0' or 'wlan0' or 'WiFi'
  private port = 5540; // first commissioning server port
  private passcode?: number; // first commissioning server passcode
  private discriminator?: number; // first commissioning server discriminator
  private log!: AnsiLogger;
  private hasCleanupStarted = false;
  // private plugins = new Map<string, RegisteredPlugin>();
  // private devices = new Map<string, RegisteredDevice>();
  private registeredPlugins: RegisteredPlugin[] = [];
  private registeredDevices: RegisteredDevice[] = [];
  private nodeStorage: NodeStorageManager | undefined;
  private nodeContext: NodeStorage | undefined;

  private expressApp: express.Express | undefined;
  private httpServer: Server | undefined;
  private httpsServer: Server | undefined;
  private webSocketServer: WebSocketServer | undefined;

  private storageManager: StorageManager | undefined;
  private matterbridgeContext: StorageContext | undefined;
  private mattercontrollerContext: StorageContext | undefined;

  private matterServer: MatterServer | undefined;
  private matterAggregator: Aggregator | undefined;
  private commissioningServer: CommissioningServer | undefined;
  private commissioningController: CommissioningController | undefined;

  private static instance: Matterbridge | undefined;

  // We load asyncronously so is private
  private constructor() {
    super();
  }

  /**
   * Loads an instance of the Matterbridge class.
   * If an instance already exists, return that instance.
   *
   * @param initialize - Whether to initialize the Matterbridge instance after loading.
   * @returns The loaded Matterbridge instance.
   */
  static async loadInstance(initialize = false) {
    if (!Matterbridge.instance) {
      // eslint-disable-next-line no-console
      if (hasParameter('debug')) console.log(wr + 'Creating a new instance of Matterbridge.', initialize ? 'Initializing...' : 'Not initializing...', rs);
      Matterbridge.instance = new Matterbridge();
      if (initialize) await Matterbridge.instance.initialize();
    }
    return Matterbridge.instance;
  }

  /**
   * Call shutdownProcess.
   * @deprecated This method is deprecated and is only used for jest.
   *
   */
  async destroyInstance() {
    await this.shutdownProcess();
  }

  /**
   * Initializes the Matterbridge instance as extension for zigbee2mqtt.
   * @deprecated This method is deprecated and will be removed in a future version.
   *
   * @returns A Promise that resolves when the initialization is complete.
   */
  public async startExtension(dataPath: string, debugEnabled: boolean, extensionVersion: string, port = 5560): Promise<boolean> {
    // Set the bridge mode
    this.bridgeMode = 'bridge';

    // Set the first port to use
    this.port = port;

    // Set Matterbridge logger
    this.debugEnabled = debugEnabled;
    this.log = new AnsiLogger({ logName: 'Matterbridge', logTimestampFormat: TimestampFormat.TIME_MILLIS, logDebug: this.debugEnabled });
    this.log.debug('Matterbridge extension is starting...');

    // Initialize NodeStorage
    this.matterbridgeDirectory = dataPath;
    this.log.debug('Creating node storage manager dir: ' + path.join(this.matterbridgeDirectory, 'node_storage'));
    this.nodeStorage = new NodeStorageManager({ dir: path.join(this.matterbridgeDirectory, 'node_storage'), logging: false });
    this.log.debug('Creating node storage context for matterbridge: matterbridge');
    this.nodeContext = await this.nodeStorage.createStorage('matterbridge');

    const plugin: RegisteredPlugin = {
      path: '',
      type: 'DynamicPlatform',
      name: 'MatterbridgeExtension',
      version: '1.0.0',
      description: 'Matterbridge extension',
      author: 'https://github.com/Luligu',
      enabled: false,
      registeredDevices: 0,
      addedDevices: 0,
    };
    this.registeredPlugins.push(plugin);
    await this.nodeContext?.set<RegisteredPlugin[]>('plugins', await this.getBaseRegisteredPlugins());

    // Log system info and create .matterbridge directory
    await this.logNodeAndSystemInfo();
    this.matterbridgeDirectory = dataPath;

    // Set matter.js logger level and format
    Logger.defaultLogLevel = this.debugEnabled ? Level.DEBUG : Level.INFO;
    Logger.format = Format.ANSI;

    // Start the storage and create matterbridgeContext
    await this.startStorage('json', path.join(this.matterbridgeDirectory, 'matterbridge.json'));
    if (!this.storageManager) return false;
    this.matterbridgeContext = await this.createCommissioningServerContext('Matterbridge', 'Matterbridge zigbee2MQTT', DeviceTypes.AGGREGATOR.code, 0xfff1, 'Matterbridge', 0x8000, 'zigbee2MQTT Matter extension');
    if (!this.matterbridgeContext) return false;
    await this.matterbridgeContext.set('softwareVersion', 1);
    await this.matterbridgeContext.set('softwareVersionString', this.matterbridgeVersion);
    await this.matterbridgeContext.set('hardwareVersion', 1);
    await this.matterbridgeContext.set('hardwareVersionString', extensionVersion); // Update with the extension version
    this.matterServer = this.createMatterServer(this.storageManager);
    this.log.debug(`Creating commissioning server for ${plg}Matterbridge${db}`);
    this.commissioningServer = await this.createCommisioningServer(this.matterbridgeContext, 'Matterbridge');
    this.log.debug(`Creating matter aggregator for ${plg}Matterbridge${db}`);
    this.matterAggregator = await this.createMatterAggregator(this.matterbridgeContext, 'Matterbridge');
    this.log.debug('Adding matterbridge aggregator to commissioning server');
    this.commissioningServer.addDevice(this.matterAggregator);
    this.log.debug('Adding matterbridge commissioning server to matter server');
    await this.matterServer.addCommissioningServer(this.commissioningServer, { uniqueStorageKey: 'Matterbridge' });
    await this.startMatterServer();
    this.log.info('Matter server started');
    await this.showCommissioningQRCode(this.commissioningServer, this.matterbridgeContext, this.nodeContext, 'Matterbridge');
    // Set reachability to true and trigger event after 60 seconds
    setTimeout(() => {
      this.log.info(`Setting reachability to true for ${plg}Matterbridge${db}`);
      if (this.commissioningServer) this.setCommissioningServerReachability(this.commissioningServer, true);
      if (this.matterAggregator) this.setAggregatorReachability(this.matterAggregator, true);
    }, 60 * 1000);
    return this.commissioningServer.isCommissioned();
  }

  /**
   * Close the Matterbridge instance as extension for zigbee2mqtt.
   * @deprecated This method is deprecated and will be removed in a future version.
   *
   * @returns A Promise that resolves when the initialization is complete.
   */
  public async stopExtension() {
    // Closing matter
    await this.stopMatter();

    // Clearing the session manager
    // this.matterbridgeContext?.createContext('SessionManager').clear();

    // Closing storage
    await this.stopStorage();

    this.log.info('Matter server stopped');
  }

  /**
   * Checks if the extension is commissioned.
   * @deprecated This method is deprecated and will be removed in a future version.
   *
   * @returns {boolean} Returns true if the extension is commissioned, false otherwise.
   */
  public isExtensionCommissioned(): boolean {
    if (!this.commissioningServer) return false;
    return this.commissioningServer.isCommissioned();
  }

  /**
   * Initializes the Matterbridge application.
   *
   * @remarks
   * This method performs the necessary setup and initialization steps for the Matterbridge application.
   * It displays the help information if the 'help' parameter is provided, sets up the logger, checks the
   * node version, registers signal handlers, initializes storage, and parses the command line.
   *
   * @returns A Promise that resolves when the initialization is complete.
   */
  public async initialize() {
    // Display the help
    if (hasParameter('help')) {
      // eslint-disable-next-line no-console
      console.log(`\nUsage: matterbridge [options]\n
      Options:
      - help:                  show the help
      - bridge:                start Matterbridge in bridge mode
      - childbridge:           start Matterbridge in childbridge mode
      - port [port]:           start the commissioning server on the given port (default 5540)
      - mdnsinterface [name]:  set the interface to use for the matter server mdnsInterface (default all interfaces)
      - frontend [port]:       start the frontend on the given port (default 8283)
      - debug:                 enable the Matterbridge debug mode (default false)
      - matterlogger:          set the matter.js logger level: debug | info | notice | warn | error | fatal (default info)
      - reset:                 remove the commissioning for Matterbridge (bridge mode). Shutdown Matterbridge before using it!
      - factoryreset:          remove all commissioning information and reset all internal storages. Shutdown Matterbridge before using it!
      - list:                  list the registered plugins
      - loginterfaces:         log the network interfaces (usefull for finding the name of the interface to use with -mdnsinterface option)
      - logstorage:            log the node storage
      - ssl:                   enable SSL for the frontend and WebSockerServer (certificates in .matterbridge/certs directory cert.pem, key.pem and ca.pem (optional))
      - add [plugin path]:     register the plugin from the given absolute or relative path
      - add [plugin name]:     register the globally installed plugin with the given name
      - remove [plugin path]:  remove the plugin from the given absolute or relative path
      - remove [plugin name]:  remove the globally installed plugin with the given name
      - enable [plugin path]:  enable the plugin from the given absolute or relative path
      - enable [plugin name]:  enable the globally installed plugin with the given name
      - disable [plugin path]: disable the plugin from the given absolute or relative path
      - disable [plugin name]: disable the globally installed plugin with the given name
      - reset [plugin path]:   remove the commissioning for the plugin from the given absolute or relative path (childbridge mode). Shutdown Matterbridge before using it!
      - reset [plugin name]:   remove the commissioning for the globally installed plugin (childbridge mode). Shutdown Matterbridge before using it!\n`);
      process.exit(0);
    }

    // Set the interface to use for the matter server mdnsInterface
    this.mdnsInterface = getParameter('mdnsinterface');

    // Set the first port to use for the commissioning server (will be incremented in childbridge mode)
    this.port = getIntParameter('port') ?? 5540;
    // Set the first passcode to use for the commissioning server (will be incremented in childbridge mode)
    this.passcode = getIntParameter('passcode');
    // Set the first discriminator to use for the commissioning server (will be incremented in childbridge mode)
    this.discriminator = getIntParameter('discriminator');

    // Set the restart mode
    if (hasParameter('service')) this.restartMode = 'service';
    if (hasParameter('docker')) this.restartMode = 'docker';

    // Set Matterbridge logger
    if (hasParameter('debug')) this.debugEnabled = true;
    this.log = new AnsiLogger({ logName: 'Matterbridge', logTimestampFormat: TimestampFormat.TIME_MILLIS, logDebug: this.debugEnabled });
    this.log.debug('Matterbridge is starting...');

    // Initialize NodeStorage
    this.homeDirectory = os.homedir();
    this.matterbridgeDirectory = path.join(this.homeDirectory, '.matterbridge');
    this.log.debug('Creating node storage manager');
    this.nodeStorage = new NodeStorageManager({ dir: path.join(this.matterbridgeDirectory, 'storage'), logging: false });
    this.log.debug('Creating node storage context for matterbridge');
    this.nodeContext = await this.nodeStorage.createStorage('matterbridge');

    // Get the plugins from node storage and create the plugin node storage contexts
    this.registeredPlugins = await this.nodeContext.get<RegisteredPlugin[]>('plugins', []);
    for (const plugin of this.registeredPlugins) {
      const packageJson = await this.parsePlugin(plugin);
      if (packageJson) {
        // Update the plugin information
        plugin.name = packageJson.name as string;
        plugin.version = packageJson.version as string;
        plugin.description = packageJson.description as string;
        plugin.author = packageJson.author as string;
      } else {
        this.log.info(`Error parsing plugin ${plg}${plugin.name}${nf}. Trying to reinstall it from npm.`);
        try {
          await this.spawnCommand('npm', ['install', '-g', plugin.name]);
          this.log.info(`Plugin ${plg}${plugin.name}${nf} reinstalled.`);
          plugin.error = false;
        } catch (error) {
          plugin.error = true;
          plugin.enabled = false;
          this.log.error(`Error installing plugin ${plg}${plugin.name}${er}. The plugin is disabled.`);
        }
      }
      this.log.debug(`Creating node storage context for plugin ${plugin.name}`);
      plugin.nodeContext = await this.nodeStorage.createStorage(plugin.name);
      await plugin.nodeContext.set<string>('name', plugin.name);
      await plugin.nodeContext.set<string>('type', plugin.type);
      await plugin.nodeContext.set<string>('path', plugin.path);
      await plugin.nodeContext.set<string>('version', plugin.version);
      await plugin.nodeContext.set<string>('description', plugin.description);
      await plugin.nodeContext.set<string>('author', plugin.author);
    }

    // Log system info and create .matterbridge directory
    await this.logNodeAndSystemInfo();
    this.log.info(
      `Matterbridge version ${this.matterbridgeVersion} mode ${hasParameter('bridge') ? 'bridge' : ''}${hasParameter('childbridge') ? 'childbridge' : ''}${hasParameter('controller') ? 'controller' : ''} ` +
        `${this.restartMode !== '' ? 'restart mode ' + this.restartMode + ' ' : ''}running on ${this.systemInformation.osType} ${this.systemInformation.osRelease} ${this.systemInformation.osPlatform} ${this.systemInformation.osArch} `,
    );

    // Check node version and throw error
    requireMinNodeVersion(18);

    // Register SIGINT SIGTERM signal handlers
    this.registerSignalHandlers();

    // Set matter.js logger level and format
    if (hasParameter('matterlogger')) {
      const level = getParameter('matterlogger');
      if (level === 'debug') {
        Logger.defaultLogLevel = Level.DEBUG;
      } else if (level === 'info') {
        Logger.defaultLogLevel = Level.INFO;
      } else if (level === 'notice') {
        Logger.defaultLogLevel = Level.NOTICE;
      } else if (level === 'warn') {
        Logger.defaultLogLevel = Level.WARN;
      } else if (level === 'error') {
        Logger.defaultLogLevel = Level.ERROR;
      } else if (level === 'fatal') {
        Logger.defaultLogLevel = Level.FATAL;
      } else {
        this.log.warn(`Invalid matterlogger level: ${level}. Using default level ${this.debugEnabled ? 'debug' : 'info'}.`);
        Logger.defaultLogLevel = Level.INFO;
      }
    } else {
      Logger.defaultLogLevel = Level.INFO;
    }
    Logger.format = Format.ANSI;

    // Parse command line
    await this.parseCommandLine();
  }

  /**
   * Parses the command line arguments and performs the corresponding actions.
   * @private
   * @returns {Promise<void>} A promise that resolves when the command line arguments have been processed, or the process exits.
   */
  private async parseCommandLine(): Promise<void> {
    if (hasParameter('list')) {
      this.log.info(`│ Registered plugins (${this.registeredPlugins?.length})`);
      this.registeredPlugins.forEach((plugin, index) => {
        if (index !== this.registeredPlugins.length - 1) {
          this.log.info(`├─┬─ plugin ${plg}${plugin.name}${nf}: "${plg}${BRIGHT}${plugin.description}${RESET}${nf}" type: ${typ}${plugin.type}${nf} ${plugin.enabled ? GREEN : RED}enabled ${plugin.paired ? GREEN : RED}paired${nf}`);
          this.log.info(`│ └─ entry ${UNDERLINE}${db}${plugin.path}${UNDERLINEOFF}${db}`);
        } else {
          this.log.info(`└─┬─ plugin ${plg}${plugin.name}${nf}: "${plg}${BRIGHT}${plugin.description}${RESET}${nf}" type: ${typ}${plugin.type}${nf} ${plugin.enabled ? GREEN : RED}enabled ${plugin.paired ? GREEN : RED}paired${nf}`);
          this.log.info(`  └─ entry ${UNDERLINE}${db}${plugin.path}${UNDERLINEOFF}${db}`);
        }
      });
      const serializedRegisteredDevices = await this.nodeContext?.get<SerializedMatterbridgeDevice[]>('devices', []);
      this.log.info(`│ Registered devices (${serializedRegisteredDevices?.length})`);
      serializedRegisteredDevices?.forEach((device, index) => {
        if (index !== serializedRegisteredDevices.length - 1) {
          this.log.info(`├─┬─ plugin ${plg}${device.pluginName}${nf} device: ${dev}${device.deviceName}${nf} uniqueId: ${YELLOW}${device.uniqueId}${nf}`);
          this.log.info(`│ └─ endpoint ${RED}${device.endpoint}${nf} ${typ}${device.endpointName}${nf} ${debugStringify(device.clusterServersId)}`);
        } else {
          this.log.info(`└─┬─ plugin ${plg}${device.pluginName}${nf} device: ${dev}${device.deviceName}${nf} uniqueId: ${YELLOW}${device.uniqueId}${nf}`);
          this.log.info(`  └─ endpoint ${RED}${device.endpoint}${nf} ${typ}${device.endpointName}${nf} ${debugStringify(device.clusterServersId)}`);
        }
      });
      this.emit('shutdown');
      process.exit(0);
    }

    if (hasParameter('logstorage')) {
      this.log.info(`${plg}Matterbridge${nf} storage log`);
      await this.nodeContext?.logStorage();
      for (const plugin of this.registeredPlugins) {
        this.log.info(`${plg}${plugin.name}${nf} storage log`);
        await plugin.nodeContext?.logStorage();
      }
      this.emit('shutdown');
      process.exit(0);
    }

    if (hasParameter('loginterfaces')) {
      this.log.info(`${plg}Matterbridge${nf} network interfaces log`);
      logInterfaces();
      this.emit('shutdown');
      process.exit(0);
    }

    if (getParameter('add')) {
      this.log.debug(`Registering plugin ${getParameter('add')}`);
      await this.executeCommandLine(getParameter('add') as string, 'add');
      this.emit('shutdown');
      process.exit(0);
    }
    if (getParameter('remove')) {
      this.log.debug(`Unregistering plugin ${getParameter('remove')}`);
      await this.executeCommandLine(getParameter('remove') as string, 'remove');
      this.emit('shutdown');
      process.exit(0);
    }
    if (getParameter('enable')) {
      this.log.debug(`Enable plugin ${getParameter('enable')}`);
      await this.executeCommandLine(getParameter('enable') as string, 'enable');
      this.emit('shutdown');
      process.exit(0);
    }
    if (getParameter('disable')) {
      this.log.debug(`Disable plugin ${getParameter('disable')}`);
      await this.executeCommandLine(getParameter('disable') as string, 'disable');
      this.emit('shutdown');
      process.exit(0);
    }

    if (hasParameter('factoryreset')) {
      try {
        // Delete matter storage file
        await fs.unlink(path.join(this.matterbridgeDirectory, 'matterbridge.json'));
      } catch (err) {
        this.log.error(`Error deleting storage: ${err}`);
      }
      try {
        // Delete node storage directory with its subdirectories
        await fs.rm(path.join(this.matterbridgeDirectory, 'storage'), { recursive: true });
      } catch (err) {
        this.log.error(`Error removing storage directory: ${err}`);
      }
      this.log.info('Factory reset done! Remove all paired devices from the controllers.');
      this.emit('shutdown');
      process.exit(0);
    }

    // Start the storage and create matterbridgeContext (we need it now for frontend and later for matterbridge)
    await this.startStorage('json', path.join(this.matterbridgeDirectory, 'matterbridge.json'));
    this.matterbridgeContext = await this.createCommissioningServerContext('Matterbridge', 'Matterbridge', DeviceTypes.AGGREGATOR.code, 0xfff1, 'Matterbridge', 0x8000, 'Matterbridge aggregator');

    if (hasParameter('reset') && getParameter('reset') === undefined) {
      this.log.info('Resetting Matterbridge commissioning information...');
      await this.matterbridgeContext?.clearAll();
      await this.stopStorage();
      this.log.info('Reset done! Remove the device from the controller.');
      this.emit('shutdown');
      process.exit(0);
    }

    if (getParameter('reset') && getParameter('reset') !== undefined) {
      this.log.debug(`Reset plugin ${getParameter('reset')}`);
      await this.executeCommandLine(getParameter('reset') as string, 'reset');
      await this.stopStorage();
      this.emit('shutdown');
      process.exit(0);
    }

    // Initialize frontend
    if (getIntParameter('frontend') !== 0 || getIntParameter('frontend') === undefined) await this.initializeFrontend(getIntParameter('frontend'));

    // Check each 60 minutes the latest versions
    this.checkUpdateInterval = setInterval(
      () => {
        this.getMatterbridgeLatestVersion();
        this.registeredPlugins.forEach((plugin) => {
          this.getPluginLatestVersion(plugin);
        });
      },
      60 * 60 * 1000,
    );

    if (hasParameter('test')) {
      this.bridgeMode = 'childbridge';
      MatterbridgeDevice.bridgeMode = 'childbridge';
      await this.testStartMatterBridge();
      return;
    }

    if (hasParameter('controller')) {
      this.bridgeMode = 'controller';
      await this.startMattercontroller();
      return;
    }

    if (hasParameter('bridge')) {
      this.bridgeMode = 'bridge';
      MatterbridgeDevice.bridgeMode = 'bridge';

      if (!this.storageManager) {
        this.log.error('No storage manager initialized');
        await this.cleanup('No storage manager initialized');
        return;
      }
      this.log.debug('Starting matterbridge in mode', this.bridgeMode);
      this.matterServer = this.createMatterServer(this.storageManager);

      this.log.debug(`Creating commissioning server context for ${plg}Matterbridge${db}`);
      this.matterbridgeContext = await this.createCommissioningServerContext('Matterbridge', 'Matterbridge', DeviceTypes.AGGREGATOR.code, 0xfff1, 'Matterbridge', 0x8000, 'Matterbridge Aggregator');
      if (!this.matterbridgeContext) {
        this.log.error(`Error creating storage context for ${plg}Matterbridge${er}`);
        return;
      }
      if (!this.nodeContext) {
        this.log.error(`Node storage context undefined for ${plg}Matterbridge${er}`);
        return;
      }
      this.log.debug(`Creating commissioning server for ${plg}Matterbridge${db}`);
      this.commissioningServer = await this.createCommisioningServer(this.matterbridgeContext, 'Matterbridge');
      this.log.debug(`Creating matter aggregator for ${plg}Matterbridge${db}`);
      this.matterAggregator = await this.createMatterAggregator(this.matterbridgeContext, 'Matterbridge');
      this.log.debug('Adding matterbridge aggregator to commissioning server');
      this.commissioningServer.addDevice(this.matterAggregator);
      this.log.debug('Adding matterbridge commissioning server to matter server');
      await this.matterServer.addCommissioningServer(this.commissioningServer, { uniqueStorageKey: 'Matterbridge' });

      for (const plugin of this.registeredPlugins) {
        plugin.configJson = await this.loadPluginConfig(plugin);
        plugin.schemaJson = await this.loadPluginSchema(plugin);
        // Check if the plugin is available
        if (!(await this.resolvePluginName(plugin.path))) {
          this.log.error(`Plugin ${plg}${plugin.name}${er} not found. Disabling it.`);
          plugin.enabled = false;
          plugin.error = true;
          continue;
        }
        // Check if the plugin has a new version
        this.getPluginLatestVersion(plugin);
        if (!plugin.enabled) {
          this.log.info(`Plugin ${plg}${plugin.name}${nf} not enabled`);
          continue;
        }
        plugin.error = false;
        plugin.locked = false;
        plugin.loaded = false;
        plugin.started = false;
        plugin.configured = false;
        plugin.connected = undefined;
        plugin.registeredDevices = undefined;
        plugin.addedDevices = undefined;
        plugin.qrPairingCode = undefined;
        plugin.manualPairingCode = undefined;
        this.loadPlugin(plugin, true, 'Matterbridge is starting'); // No await do it asyncronously
      }
      await this.startMatterbridge();
      return;
    }

    if (hasParameter('childbridge')) {
      this.bridgeMode = 'childbridge';
      MatterbridgeDevice.bridgeMode = 'childbridge';

      if (!this.storageManager) {
        this.log.error('No storage manager initialized');
        await this.cleanup('No storage manager initialized');
        return;
      }
      this.log.debug('Starting matterbridge in mode', this.bridgeMode);
      this.matterServer = this.createMatterServer(this.storageManager);

      for (const plugin of this.registeredPlugins) {
        plugin.configJson = await this.loadPluginConfig(plugin);
        plugin.schemaJson = await this.loadPluginSchema(plugin);
        // Check if the plugin is available
        if (!(await this.resolvePluginName(plugin.path))) {
          this.log.error(`Plugin ${plg}${plugin.name}${er} not found. Disabling it.`);
          plugin.enabled = false;
          plugin.error = true;
          continue;
        }
        // Check if the plugin has a new version
        this.getPluginLatestVersion(plugin);
        if (!plugin.enabled) {
          this.log.info(`Plugin ${plg}${plugin.name}${nf} not enabled`);
          continue;
        }
        plugin.error = false;
        plugin.locked = false;
        plugin.loaded = false;
        plugin.started = false;
        plugin.configured = false;
        plugin.connected = false;
        plugin.registeredDevices = undefined;
        plugin.addedDevices = undefined;
        plugin.qrPairingCode = (await plugin.nodeContext?.get<string>('qrPairingCode', undefined)) ?? undefined;
        plugin.manualPairingCode = (await plugin.nodeContext?.get<string>('manualPairingCode', undefined)) ?? undefined;
        this.loadPlugin(plugin, true, 'Matterbridge is starting'); // No await do it asyncronously
      }
      await this.startMatterbridge();
      return;
    }
  }

  private async savePluginsToStorage() {
    if (!this.nodeContext) {
      this.log.error('loadPluginsFromStorage() error: the node context is not initialized');
      return;
    }
    // Convert the map to an array
    // const pluginArray = Array.from(this.plugins.values());
    // await this.nodeContext.set('plugins', pluginArray);
    // TODO remove after migration done
    await this.nodeContext.set<RegisteredPlugin[]>('plugins', await this.getBaseRegisteredPlugins());
  }

  private async loadPluginsFromStorage() {
    if (!this.nodeContext) {
      this.log.error('loadPluginsFromStorage() error: the node context is not initialized');
      return;
    }
    // Load the array from storage and convert it back to a map
    // const pluginArray = await this.nodeContext.get<RegisteredPlugin[]>('plugins', []);
    // for (const plugin of pluginArray) this.plugins.set(plugin.name, plugin);
    // TODO remove after migration done
    this.registeredPlugins = await this.nodeContext.get<RegisteredPlugin[]>('plugins', []);
  }

  /**
   * Resolves the name of a plugin by loading and parsing its package.json file.
   * @param pluginPath - The path to the plugin or the path to the plugin's package.json file.
   * @returns The path to the resolved package.json file, or null if the package.json file is not found or does not contain a name.
   */
  private async resolvePluginName(pluginPath: string): Promise<string | null> {
    if (!pluginPath.endsWith('package.json')) pluginPath = path.join(pluginPath, 'package.json');

    // Resolve the package.json of the plugin
    let packageJsonPath = path.resolve(pluginPath);
    this.log.debug(`Resolving plugin from ${plg}${packageJsonPath}${db}`);

    // Check if the package.json file exists
    let packageJsonExists = false;
    try {
      await fs.access(packageJsonPath);
      packageJsonExists = true;
    } catch {
      packageJsonExists = false;
    }
    if (!packageJsonExists) {
      this.log.debug(`Package.json not found at ${packageJsonPath}`);
      this.log.debug(`Trying at ${this.globalModulesDirectory}`);
      packageJsonPath = path.join(this.globalModulesDirectory, pluginPath);
    }
    try {
      // Load the package.json of the plugin
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      if (!packageJson.name) {
        this.log.debug(`Package.json name not found at ${packageJsonPath}`);
        return null;
      }
      this.log.debug(`Package.json name: ${plg}${packageJson.name}${db} description: "${nf}${packageJson.description}${db}" found at "${nf}${packageJsonPath}${db}"`);
      return packageJsonPath;
    } catch (err) {
      this.log.debug(`Failed to load plugin from ${plg}${packageJsonPath}${er}: ${err}`);
      return null;
    }
  }

  /**
   * Loads a plugin from the specified package.json file path.
   * @param packageJsonPath - The path to the package.json file of the plugin.
   * @param mode - The mode of operation. Possible values are 'add', 'remove', 'enable', 'disable'.
   * @returns A Promise that resolves when the plugin is loaded successfully, or rejects with an error if loading fails.
   */
  private async executeCommandLine(packageJsonPath: string, mode: string) {
    packageJsonPath = (await this.resolvePluginName(packageJsonPath)) ?? packageJsonPath;
    this.log.debug(`Loading plugin from ${plg}${packageJsonPath}${db}`);
    try {
      // Load the package.json of the plugin
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      if (mode === 'add') {
        if (!this.registeredPlugins.find((plugin) => plugin.name === packageJson.name)) {
          const plugin = { path: packageJsonPath, type: '', name: packageJson.name, version: packageJson.version, description: packageJson.description, author: packageJson.author, enabled: true };
          if (await this.loadPlugin(plugin)) {
            this.registeredPlugins.push(plugin);
            await this.nodeContext?.set<RegisteredPlugin[]>('plugins', await this.getBaseRegisteredPlugins());
            this.log.info(`Plugin ${plg}${packageJsonPath}${nf} type ${plugin.type} added to matterbridge`);
          } else {
            this.log.error(`Plugin ${plg}${packageJsonPath}${wr} not added to matterbridge error`);
          }
        } else {
          this.log.warn(`Plugin ${plg}${packageJsonPath}${wr} already added to matterbridge`);
        }
      } else if (mode === 'remove') {
        if (this.registeredPlugins.find((registeredPlugin) => registeredPlugin.name === packageJson.name)) {
          this.registeredPlugins.splice(
            this.registeredPlugins.findIndex((registeredPlugin) => registeredPlugin.name === packageJson.name),
            1,
          );
          await this.nodeContext?.set<RegisteredPlugin[]>('plugins', await this.getBaseRegisteredPlugins());
          this.log.info(`Plugin ${plg}${packageJsonPath}${nf} removed from matterbridge`);
        } else {
          this.log.warn(`Plugin ${plg}${packageJsonPath}${wr} not registerd in matterbridge`);
        }
      } else if (mode === 'enable') {
        const plugin = this.registeredPlugins.find((registeredPlugin) => registeredPlugin.name === packageJson.name);
        if (plugin) {
          plugin.enabled = true;
          plugin.loaded = undefined;
          plugin.started = undefined;
          plugin.configured = undefined;
          plugin.connected = undefined;
          await this.nodeContext?.set<RegisteredPlugin[]>('plugins', await this.getBaseRegisteredPlugins());
          this.log.info(`Plugin ${plg}${packageJsonPath}${nf} enabled`);
        } else {
          this.log.warn(`Plugin ${plg}${packageJsonPath}${wr} not registerd in matterbridge`);
        }
      } else if (mode === 'disable') {
        const plugin = this.registeredPlugins.find((registeredPlugin) => registeredPlugin.name === packageJson.name);
        if (plugin) {
          plugin.enabled = false;
          plugin.loaded = undefined;
          plugin.started = undefined;
          plugin.configured = undefined;
          plugin.connected = undefined;
          await this.nodeContext?.set<RegisteredPlugin[]>('plugins', await this.getBaseRegisteredPlugins());
          this.log.info(`Plugin ${plg}${packageJsonPath}${nf} disabled`);
        } else {
          this.log.warn(`Plugin ${plg}${packageJsonPath}${wr} not registerd in matterbridge`);
        }
      } else if (mode === 'reset') {
        const plugin = this.registeredPlugins.find((registeredPlugin) => registeredPlugin.name === packageJson.name);
        if (plugin) {
          plugin.loaded = undefined;
          plugin.started = undefined;
          plugin.configured = undefined;
          plugin.connected = undefined;
          plugin.paired = undefined;
          plugin.connected = undefined;
          if (!this.storageManager) this.log.error(`Plugin ${plg}${plugin.name}${er} storageManager not found`);
          const context = this.storageManager?.createContext(plugin.name);
          if (!context) this.log.error(`Plugin ${plg}${plugin.name}${er} context not found`);
          await context?.clearAll();
          await this.nodeContext?.set<RegisteredPlugin[]>('plugins', await this.getBaseRegisteredPlugins());
          this.log.info(`Reset commissionig for plugin ${plg}${plugin.name}${nf} done! Remove the device from the controller.`);
        } else {
          this.log.warn(`Plugin ${plg}${packageJsonPath}${wr} not registerd in matterbridge`);
        }
      }
    } catch (err) {
      this.log.error(`Failed to load plugin from ${plg}${packageJsonPath}${er}: ${err}`);
    }
  }

  /**
   * Registers the signal handlers for SIGINT and SIGTERM.
   * When either of these signals are received, the cleanup method is called with an appropriate message.
   */
  private async registerSignalHandlers() {
    this.log.debug(`Registering SIGINT and SIGTERM signal handlers...`);
    process.once('SIGINT', async () => {
      await this.cleanup('SIGINT received, cleaning up...');
    });

    process.once('SIGTERM', async () => {
      await this.cleanup('SIGTERM received, cleaning up...');
    });
  }

  /**
   * Update matterbridge.
   */
  private async updateProcess() {
    await this.cleanup('updating...', false);
  }

  /**
   * Restarts the process by spawning a new process and exiting the current process.
   */
  private async restartProcess() {
    await this.cleanup('restarting...', true);
  }

  /**
   * Shut down the process by exiting the current process.
   */
  private async shutdownProcess() {
    await this.cleanup('shutting down...', false);
  }

  /**
   * Shut down the process and reset.
   */
  private async unregisterAndShutdownProcess() {
    this.log.info('Unregistering all devices and shutting down...');
    for (const plugin of this.registeredPlugins.filter((plugin) => plugin.enabled && !plugin.error)) {
      await this.removeAllBridgedDevices(plugin.name);
    }
    await this.cleanup('unregistered all devices and shutting down...', false);
  }

  /**
   * Shut down the process and reset.
   */
  private async shutdownProcessAndReset() {
    await this.cleanup('shutting down with reset...', false);
  }

  /**
   * Shut down the process and factory reset.
   */
  private async shutdownProcessAndFactoryReset() {
    await this.cleanup('shutting down with factory reset...', false);
  }

  /**
   * Cleans up the Matterbridge instance.
   * @param message - The cleanup message.
   * @param restart - Indicates whether to restart the instance after cleanup. Default is `false`.
   * @returns A promise that resolves when the cleanup is completed.
   */
  private async cleanup(message: string, restart = false) {
    if (!this.hasCleanupStarted) {
      this.hasCleanupStarted = true;
      this.log.info(message);

      // Remove all listeners from the process
      process.removeAllListeners();
      this.log.debug('All listeners removed');

      // Clear the update interval
      if (this.checkUpdateInterval) clearInterval(this.checkUpdateInterval);
      this.checkUpdateInterval = undefined;
      this.log.debug('Update interval cleared');

      // Calling the shutdown method of each plugin
      for (const plugin of this.registeredPlugins) {
        if (!plugin.enabled || plugin.error) continue;
        this.log.info(`Shutting down plugin ${plg}${plugin.name}${nf}`);
        if (plugin.platform) {
          try {
            await plugin.platform.onShutdown('Matterbridge is closing: ' + message);
            // await this.savePluginConfig(plugin);
          } catch (error) {
            this.log.error(`Plugin ${plg}${plugin.name}${er} shutting down error: ${error}`);
          }
        } else {
          this.log.debug(`Plugin ${plg}${plugin.name}${db} platform not found`);
        }
      }

      // Set reachability to false
      /*
      this.log.debug(`*Changing reachability to false for ${this.registeredDevices.length} devices (${this.bridgeMode} mode):`);
      this.registeredDevices.forEach((registeredDevice) => {
        const plugin = this.registeredPlugins.find((plugin) => plugin.name === registeredDevice.plugin);
        if (!plugin) {
          this.log.error(`Plugin ${plg}${registeredDevice.plugin}${er} not found`);
          return;
        }
        if (this.bridgeMode === 'bridge' && registeredDevice.device.number) {
          this.log.debug(`*-- device: ${dev}${registeredDevice.device.name}${db} plugin ${plg}${registeredDevice.plugin}${db} type ${plugin.type}${db}`);
          registeredDevice.device.setBridgedDeviceReachability(false);
          registeredDevice.device.getClusterServerById(BridgedDeviceBasicInformation.Cluster.id)?.triggerReachableChangedEvent({ reachableNewValue: false });
        }
        if (this.bridgeMode === 'childbridge') {
          if (plugin.type === 'DynamicPlatform' && registeredDevice.device.number) {
            this.log.debug(`*-- device: ${dev}${registeredDevice.device.name}${db} plugin ${plg}${registeredDevice.plugin}${db} type ${plugin.type}${db}`);
            registeredDevice.device.setBridgedDeviceReachability(false);
            registeredDevice.device.getClusterServerById(BridgedDeviceBasicInformation.Cluster.id)?.triggerReachableChangedEvent({ reachableNewValue: false });
          }
        }
      });
      if (this.bridgeMode === 'bridge') {
        this.log.debug('*Changing reachability to false for Matterbridge');
        this.matterAggregator?.getClusterServerById(BasicInformation.Cluster.id)?.setReachableAttribute(false);
        this.matterAggregator?.getClusterServerById(BasicInformation.Cluster.id)?.triggerReachableChangedEvent({ reachableNewValue: false });
        this.commissioningServer?.setReachability(false);
      }
      if (this.bridgeMode === 'childbridge') {
        for (const plugin of this.registeredPlugins) {
          if (!plugin.enabled || plugin.error) continue;
          this.log.debug(`*Changing reachability to false for plugin ${plg}${plugin.name}${db} type ${plugin.type}`);
          plugin.aggregator?.getClusterServerById(BasicInformation.Cluster.id)?.setReachableAttribute(false);
          plugin.aggregator?.getClusterServerById(BasicInformation.Cluster.id)?.triggerReachableChangedEvent({ reachableNewValue: false });
          plugin.commissioningServer?.setReachability(false);
        }
      }
      */

      // Close the express server
      /*
      if (this.expressServer) {
        this.expressServer.close();
        this.expressServer.removeAllListeners();
        this.expressServer = undefined;
        this.log.debug('Express server closed successfully');
      }
      */
      // Close the http server
      if (this.httpServer) {
        this.httpServer.close();
        this.httpServer.removeAllListeners();
        this.httpServer = undefined;
        this.log.debug('Frontend http server closed successfully');
      }
      // Close the https server
      if (this.httpsServer) {
        this.httpsServer.close();
        this.httpsServer.removeAllListeners();
        this.httpsServer = undefined;
        this.log.debug('Frontend https server closed successfully');
      }
      // Remove listeners from the express app
      if (this.expressApp) {
        this.expressApp.removeAllListeners();
        this.expressApp = undefined;
        this.log.debug('Frontend app closed successfully');
      }
      // Close the WebSocket server
      if (this.webSocketServer) {
        // Close all active connections
        this.webSocketServer.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.close();
          }
        });
        this.webSocketServer.close((error) => {
          if (error) {
            this.log.error(`Error closing WebSocket server: ${error}`);
          } else {
            this.log.debug('WebSocket server closed successfully');
          }
        });
        this.webSocketServer = undefined;
      }

      const cleanupTimeout1 = setTimeout(async () => {
        // Closing matter
        await this.stopMatter();

        // Closing storage
        await this.stopStorage();

        // Serialize registeredDevices
        if (this.nodeStorage && this.nodeContext) {
          this.log.info('Saving registered devices...');
          const serializedRegisteredDevices: SerializedMatterbridgeDevice[] = [];
          this.registeredDevices.forEach((registeredDevice) => {
            const serializedMatterbridgeDevice = registeredDevice.device.serialize(registeredDevice.plugin);
            // this.log.info(`- ${serializedMatterbridgeDevice.deviceName}${rs}\n`, serializedMatterbridgeDevice);
            if (serializedMatterbridgeDevice) serializedRegisteredDevices.push(serializedMatterbridgeDevice);
          });
          await this.nodeContext.set<SerializedMatterbridgeDevice[]>('devices', serializedRegisteredDevices);
          this.log.info(`Saved registered devices (${serializedRegisteredDevices?.length})`);
          // Clear nodeContext and nodeStorage (they just need 1000ms to write the data to disk)
          this.log.debug('Closing node storage context...');
          this.nodeContext.close();
          this.nodeContext = undefined;
          this.log.debug('Closing node storage manager...');
          this.nodeStorage.close();
          this.nodeStorage = undefined;
        } else {
          this.log.error('Error saving registered devices: nodeContext not found!');
        }
        this.registeredPlugins = [];
        this.registeredDevices = [];

        this.log.info('Waiting for matter to deliver last messages...');
        const cleanupTimeout2 = setTimeout(async () => {
          if (restart) {
            if (message === 'updating...') {
              this.log.info('Cleanup completed. Updating...');
              Matterbridge.instance = undefined;
              this.emit('update');
            } else if (message === 'restarting...') {
              this.log.info('Cleanup completed. Restarting...');
              Matterbridge.instance = undefined;
              this.emit('restart');
            }
          } else {
            if (message === 'shutting down with reset...') {
              // Delete matter storage file
              this.log.info('Resetting Matterbridge commissioning information...');
              await fs.unlink(path.join(this.matterbridgeDirectory, 'matterbridge.json'));
              this.log.info('Reset done! Remove all paired devices from the controllers.');
            }
            if (message === 'shutting down with factory reset...') {
              // Delete matter storage file
              this.log.info('Resetting Matterbridge commissioning information...');
              await fs.unlink(path.join(this.matterbridgeDirectory, 'matterbridge.json'));
              // Delete node storage directory with its subdirectories
              this.log.info('Resetting Matterbridge storage...');
              await fs.rm(path.join(this.matterbridgeDirectory, 'storage'), { recursive: true });
              this.log.info('Factory reset done! Remove all paired devices from the controllers.');
            }
            this.log.info('Cleanup completed. Shutting down...');
            Matterbridge.instance = undefined;
            this.emit('shutdown');
          }
          this.hasCleanupStarted = false;
        }, 2 * 1000);
        cleanupTimeout2.unref();
      }, 3 * 1000);
      cleanupTimeout1.unref();
    }
  }

  /**
   * Adds a bridged device to the Matterbridge.
   * @param pluginName - The name of the plugin.
   * @param device - The bridged device to add.
   * @returns {Promise<void>} - A promise that resolves when the device is added.
   */
  async addBridgedDevice(pluginName: string, device: MatterbridgeDevice): Promise<void> {
    if (this.bridgeMode === 'bridge' && !this.matterAggregator) {
      this.log.error(`Adding bridged device ${dev}${device.deviceName}${er} (${dev}${device.name}${er}) for plugin ${plg}${pluginName}${er} error: matterAggregator not found`);
      return;
    }
    this.log.debug(`Adding bridged device ${dev}${device.deviceName}${db} (${dev}${device.name}${db}) for plugin ${plg}${pluginName}${db}`);

    // Check if the plugin is registered
    const plugin = this.registeredPlugins.find((plugin) => plugin.name === pluginName);
    if (!plugin) {
      this.log.error(`Error adding bridged device ${dev}${device.deviceName}${er} (${dev}${device.name}${er}) plugin ${plg}${pluginName}${er} not found`);
      return;
    }

    // Register and add the device to matterbridge aggregator in bridge mode
    if (this.bridgeMode === 'bridge') {
      this.matterAggregator?.addBridgedDevice(device);
    }

    // The first time create the commissioning server and the aggregator for DynamicPlatform
    // Register and add the device in childbridge mode
    if (this.bridgeMode === 'childbridge') {
      if (plugin.type === 'AccessoryPlatform') {
        if (!plugin.locked) {
          plugin.locked = true;
          plugin.storageContext = await this.importCommissioningServerContext(plugin.name, device);
          this.log.debug(`Creating commissioning server for ${plg}${plugin.name}${db}`);
          plugin.commissioningServer = await this.createCommisioningServer(plugin.storageContext, plugin.name);
          this.log.debug(`Adding device ${dev}${device.name}${db} to commissioning server for plugin ${plg}${plugin.name}${db}`);
          plugin.commissioningServer.addDevice(device);
          plugin.device = device;
          this.log.debug(`Adding commissioning server to matter server for plugin ${plg}${plugin.name}${db}`);
          await this.matterServer?.addCommissioningServer(plugin.commissioningServer, { uniqueStorageKey: plugin.name });
        }
      }

      if (plugin.type === 'DynamicPlatform') {
        if (!plugin.locked) {
          plugin.locked = true;
          this.log.debug(`Creating commissioning server context for ${plg}${plugin.name}${db}`);
          // plugin.storageContext = await this.createCommissioningServerContext(plugin.name, 'Matterbridge', DeviceTypes.AGGREGATOR.code, 0xfff1, 'Matterbridge', 0x8000, 'Matterbridge Dynamic Platform');
          plugin.storageContext = await this.createCommissioningServerContext(plugin.name, 'Matterbridge', DeviceTypes.AGGREGATOR.code, 0xfff1, 'Matterbridge', 0x8000, plugin.description);
          this.log.debug(`Creating commissioning server for ${plg}${plugin.name}${db}`);
          plugin.commissioningServer = await this.createCommisioningServer(plugin.storageContext, plugin.name);
          this.log.debug(`Creating aggregator for plugin ${plg}${plugin.name}${db}`);
          plugin.aggregator = await this.createMatterAggregator(plugin.storageContext, plugin.name); // Generate serialNumber and uniqueId
          this.log.debug(`Adding matter aggregator to commissioning server for plugin ${plg}${plugin.name}${db}`);
          plugin.commissioningServer.addDevice(plugin.aggregator);
          this.log.debug(`Adding commissioning server to matter server for plugin ${plg}${plugin.name}${db}`);
          await this.matterServer?.addCommissioningServer(plugin.commissioningServer, { uniqueStorageKey: plugin.name });
        }
        plugin.aggregator?.addBridgedDevice(device);
      }
    }
    this.registeredDevices.push({ plugin: pluginName, device });
    if (plugin.registeredDevices !== undefined) plugin.registeredDevices++;
    if (plugin.addedDevices !== undefined) plugin.addedDevices++;
    this.log.info(`Added and registered bridged device (${plugin.registeredDevices}/${plugin.addedDevices}) ${dev}${device.deviceName}${nf} (${dev}${device.name}${nf}) for plugin ${plg}${pluginName}${nf}`);
  }

  /**
   * Removes a bridged device from the Matterbridge.
   * @param pluginName - The name of the plugin.
   * @param device - The device to be removed.
   * @returns A Promise that resolves when the device is successfully removed.
   */
  async removeBridgedDevice(pluginName: string, device: MatterbridgeDevice): Promise<void> {
    if (this.bridgeMode === 'bridge' && !this.matterAggregator) {
      this.log.error(`Removing bridged device ${dev}${device.deviceName}${er} (${dev}${device.name}${er}) for plugin ${plg}${pluginName}${er} error: matterAggregator not found`);
      return;
    }
    this.log.debug(`Removing bridged device ${dev}${device.deviceName}${db} (${dev}${device.name}${db}) for plugin ${plg}${pluginName}${db}`);

    // Check if the plugin is registered
    const plugin = this.findPlugin(pluginName);
    if (!plugin) {
      this.log.error(`Error removing bridged device ${dev}${device.deviceName}${er} (${dev}${device.name}${er}) plugin ${plg}${pluginName}${er} not found`);
      return;
    }
    if (this.bridgeMode === 'childbridge' && !plugin.aggregator) {
      this.log.error(`Error removing bridged device ${dev}${device.deviceName}${er} (${dev}${device.name}${er}) plugin ${plg}${pluginName}${er} aggregator not found`);
      return;
    }
    if (this.bridgeMode === 'childbridge' && !plugin.connected) {
      this.log.info(`Removing bridged device ${dev}${device.deviceName}${wr} (${dev}${device.name}${wr}) plugin ${plg}${pluginName}${wr} not connected`);
      return;
    }

    // Remove the device from matterbridge aggregator in bridge mode
    if (this.bridgeMode === 'bridge') {
      device.setBridgedDeviceReachability(false);
      device.getClusterServerById(BridgedDeviceBasicInformation.Cluster.id)?.triggerReachableChangedEvent({ reachableNewValue: false });
      this.matterAggregator?.removeBridgedDevice(device);
      this.registeredDevices.forEach((registeredDevice, index) => {
        if (registeredDevice.device === device) {
          this.registeredDevices.splice(index, 1);
          return;
        }
      });
      this.log.info(`Removed bridged device(${plugin.registeredDevices}/${plugin.addedDevices}) ${dev}${device.deviceName}${nf} (${dev}${device.name}${nf}) for plugin ${plg}${pluginName}${nf}`);
      if (plugin.registeredDevices !== undefined) plugin.registeredDevices--;
      if (plugin.addedDevices !== undefined) plugin.addedDevices--;
    }

    // Remove the device in childbridge mode
    if (this.bridgeMode === 'childbridge') {
      if (plugin.type === 'AccessoryPlatform') {
        this.log.info(`Removing bridged device ${dev}${device.deviceName}${nf} (${dev}${device.name}${nf}) for plugin ${plg}${pluginName}${nf}: AccessoryPlatform not supported in childbridge mode`);
      } else if (plugin.type === 'DynamicPlatform') {
        this.registeredDevices.forEach((registeredDevice, index) => {
          if (registeredDevice.device === device) {
            this.registeredDevices.splice(index, 1);
            return;
          }
        });
        device.setBridgedDeviceReachability(false);
        device.getClusterServerById(BridgedDeviceBasicInformation.Cluster.id)?.triggerReachableChangedEvent({ reachableNewValue: false });
        plugin.aggregator?.removeBridgedDevice(device);
      }
      this.log.info(`Removed bridged device(${plugin.registeredDevices}/${plugin.addedDevices}) ${dev}${device.deviceName}${nf} (${dev}${device.name}${nf}) for plugin ${plg}${pluginName}${nf}`);
      if (plugin.registeredDevices !== undefined) plugin.registeredDevices--;
      if (plugin.addedDevices !== undefined) plugin.addedDevices--;
    }
  }

  /**
   * Removes all bridged devices associated with a specific plugin.
   *
   * @param pluginName - The name of the plugin.
   * @returns A promise that resolves when all devices have been removed.
   */
  async removeAllBridgedDevices(pluginName: string): Promise<void> {
    const plugin = this.findPlugin(pluginName);
    if (this.bridgeMode === 'childbridge' && plugin?.type === 'AccessoryPlatform') {
      this.log.info(`Removing devices for plugin ${plg}${pluginName}${nf} type AccessoryPlatform is not supported in childbridge mode`);
      return;
    }
    const devicesToRemove: RegisteredDevice[] = [];
    for (const registeredDevice of this.registeredDevices) {
      if (registeredDevice.plugin === pluginName) {
        devicesToRemove.push(registeredDevice);
      }
    }
    for (const registeredDevice of devicesToRemove) {
      this.removeBridgedDevice(pluginName, registeredDevice.device);
    }
  }

  /**
   * Starts the storage process based on the specified storage type and name.
   * @param {string} storageType - The type of storage to start (e.g., 'disk', 'json').
   * @param {string} storageName - The name of the storage file.
   * @returns {Promise<void>} - A promise that resolves when the storage process is started.
   */
  private async startStorage(storageType: string, storageName: string): Promise<void> {
    this.log.debug(`Starting storage ${storageType} ${storageName}`);
    if (storageType === 'disk') {
      const storageDisk = new StorageBackendDisk(storageName);
      this.storageManager = new StorageManager(storageDisk);
    } else if (storageType === 'json') {
      if (!storageName.endsWith('.json')) storageName += '.json';
      const storageJson = new StorageBackendJsonFile(storageName);
      this.storageManager = new StorageManager(storageJson);
    } else {
      this.log.error(`Unsupported storage type ${storageType}`);
      await this.cleanup('Unsupported storage type');
      return;
    }
    try {
      await this.storageManager.initialize();
      this.log.debug('Storage initialized');
      if (storageType === 'json') {
        await this.backupJsonStorage(storageName, storageName.replace('.json', '') + '.backup.json');
      }
    } catch (error) {
      this.log.error('Storage initialize() error! The file .matterbridge/matterbridge.json may be corrupted.');
      this.log.error('Please delete it and rename matterbridge.backup.json to matterbridge.json and try to restart Matterbridge.');
      await this.cleanup('Storage initialize() error!');
    }
  }

  /**
   * Makes a backup copy of the specified JSON storage file.
   *
   * @param storageName - The name of the JSON storage file to be backed up.
   * @param backupName - The name of the backup file to be created.
   */
  private async backupJsonStorage(storageName: string, backupName: string) {
    try {
      this.log.debug(`Making backup copy of ${storageName}`);
      await fs.copyFile(storageName, backupName);
      this.log.debug(`Successfully backed up ${storageName} to ${backupName}`);
    } catch (err) {
      if (err instanceof Error && 'code' in err) {
        if (err.code === 'ENOENT') {
          this.log.info(`No existing file to back up for ${storageName}. This is expected on the first run.`);
        } else {
          this.log.error(`Error making backup copy of ${storageName}: ${err.message}`);
        }
      } else {
        this.log.error(`An unexpected error occurred during the backup of ${storageName}: ${String(err)}`);
      }
    }
  }

  /**
   * Stops the storage.
   * @returns {Promise<void>} A promise that resolves when the storage is stopped.
   */
  private async stopStorage(): Promise<void> {
    this.log.debug('Stopping storage');
    await this.storageManager?.close();
    this.log.debug('Storage closed');
    this.storageManager = undefined;
    this.matterbridgeContext = undefined;
    this.mattercontrollerContext = undefined;
  }

  private async testStartMatterBridge(): Promise<void> {
    // Start the Matterbridge
  }

  /**
   * Loads the schema for a plugin.
   * If the schema file exists in the plugin directory, it reads the file and returns the parsed JSON data and delete the schema form .matterbridge.
   * If the schema file does not exist, it creates a new schema with the default configuration and returns it.
   *
   * @param plugin - The plugin for which to load the schema.
   * @returns A promise that resolves to the loaded or created schema.
   */
  private async loadPluginSchema(plugin: RegisteredPlugin): Promise<PlatformSchema> {
    let schemaFile = plugin.path.replace('package.json', `${plugin.name}.schema.json`);
    try {
      await fs.access(schemaFile);
      const data = await fs.readFile(schemaFile, 'utf8');
      const schema = JSON.parse(data) as PlatformSchema;
      schema.title = plugin.description;
      schema.description = plugin.name + ' v. ' + plugin.version + ' by ' + plugin.author;
      this.log.debug(`Schema file found: ${schemaFile}.`);
      // this.log.debug(`Schema file found: ${schemaFile}.\nSchema:${rs}\n`, schema);
      schemaFile = path.join(this.matterbridgeDirectory, `${plugin.name}.schema.json`);
      try {
        await fs.unlink(schemaFile);
        this.log.debug(`Schema file ${schemaFile} deleted.`);
      } catch (err) {
        this.log.debug(`Schema file ${schemaFile} to delete not found.`);
      }
      return schema;
    } catch (err) {
      this.log.debug(`Schema file ${schemaFile} not found. Loading default schema.`);
      const schema: PlatformSchema = {
        title: plugin.description,
        description: plugin.name + ' v. ' + plugin.version + ' by ' + plugin.author,
        type: 'object',
        properties: {
          name: {
            description: 'Plugin name',
            type: 'string',
            readOnly: true,
          },
          type: {
            description: 'Plugin type',
            type: 'string',
            readOnly: true,
          },
          debug: {
            description: 'Enable the debug for the plugin (development only)',
            type: 'boolean',
            default: false,
          },
          unregisterOnShutdown: {
            description: 'Unregister all devices on shutdown (development only)',
            type: 'boolean',
            default: false,
          },
        },
      };
      return schema;
    }
  }

  /**
   * Saves the plugin configuration to a JSON file.
   * @param plugin - The registered plugin.
   * @param config - The platform configuration.
   * @returns A promise that resolves when the configuration is saved successfully, or with an error logged.
   */
  private async savePluginConfigFromJson(plugin: RegisteredPlugin, config: PlatformConfig): Promise<void> {
    if (!config.name || !config.type || config.name !== plugin.name) {
      this.log.error(`Error saving plugin ${plg}${plugin.name}${er} config. Wrong config data content.`);
      return;
    }
    const configFile = path.join(this.matterbridgeDirectory, `${plugin.name}.config.json`);
    try {
      await this.writeFile(configFile, JSON.stringify(config, null, 2));
      plugin.configJson = config;
      this.log.debug(`Saved config file ${configFile} for plugin ${plg}${plugin.name}${db}.\nConfig:${rs}\n`, config);
    } catch (err) {
      this.log.error(`Error saving plugin ${plg}${plugin.name}${er} config: ${err}`);
      return;
    }
  }

  /**
   * Loads the configuration for a plugin.
   * If the configuration file exists, it reads the file and returns the parsed JSON data.
   * If the configuration file does not exist, it creates a new file with default configuration and returns it.
   * If any error occurs during file access or creation, it logs an error and return un empty config.
   *
   * @param plugin - The plugin for which to load the configuration.
   * @returns A promise that resolves to the loaded or created configuration.
   */
  private async loadPluginConfig(plugin: RegisteredPlugin): Promise<PlatformConfig> {
    const configFile = path.join(this.matterbridgeDirectory, `${plugin.name}.config.json`);
    try {
      await fs.access(configFile);
      const data = await fs.readFile(configFile, 'utf8');
      const config = JSON.parse(data) as PlatformConfig;
      this.log.debug(`Config file found: ${configFile}.`);
      // this.log.debug(`Config file found: ${configFile}.\nConfig:${rs}\n`, config);
      /* The first time a plugin is added to the system, the config file is created with the plugin name and type "".*/
      config.name = plugin.name;
      config.type = plugin.type;
      if (config.debug === undefined) config.debug = false;
      if (config.unregisterOnShutdown === undefined) config.unregisterOnShutdown = false;
      return config;
    } catch (err) {
      if (err instanceof Error) {
        const nodeErr = err as NodeJS.ErrnoException;
        if (nodeErr.code === 'ENOENT') {
          let config: PlatformConfig;
          if (plugin.name === 'matterbridge-zigbee2mqtt') config = zigbee2mqtt_config;
          else if (plugin.name === 'matterbridge-somfy-tahoma') config = somfytahoma_config;
          else if (plugin.name === 'matterbridge-shelly') config = shelly_config;
          else config = { name: plugin.name, type: plugin.type, debug: false, unregisterOnShutdown: false };
          try {
            await this.writeFile(configFile, JSON.stringify(config, null, 2));
            this.log.debug(`Created config file: ${configFile}.`);
            // this.log.debug(`Created config file: ${configFile}.\nConfig:${rs}\n`, config);
            return config;
          } catch (err) {
            this.log.error(`Error creating config file ${configFile}: ${err}`);
            return config;
          }
        } else {
          this.log.error(`Error accessing config file ${configFile}: ${err}`);
          return { name: plugin.name, type: plugin.type, debug: false, unregisterOnShutdown: false };
        }
      }
      this.log.error(`Error loading config file ${configFile}: ${err}`);
      return { name: plugin.name, type: plugin.type, debug: false, unregisterOnShutdown: false };
    }
  }

  /**
   * Saves the configuration of a registered plugin.
   * @param {RegisteredPlugin} plugin - The plugin whose configuration needs to be saved.
   * @returns {Promise<void>} - A promise that resolves when the configuration is successfully saved.
   * @throws {Error} - If the plugin's configuration is not found or if there is an error while saving the configuration.
   */
  private async savePluginConfig(plugin: RegisteredPlugin): Promise<void> {
    if (!plugin.platform?.config) {
      this.log.error(`Error saving plugin ${plg}${plugin.name}${er} config: config not found`);
      return Promise.reject(new Error(`Error saving plugin ${plg}${plugin.name}${er} config: config not found`));
    }
    const configFile = path.join(this.matterbridgeDirectory, `${plugin.name}.config.json`);
    try {
      await this.writeFile(configFile, JSON.stringify(plugin.platform.config, null, 2));
      this.log.debug(`Saved config file: ${configFile}.`);
      // this.log.debug(`Saved config file: ${configFile}.\nConfig:${rs}\n`, plugin.platform.config);
    } catch (err) {
      this.log.error(`Error saving plugin ${plg}${plugin.name}${er} config: ${err}`);
      return Promise.reject(err);
    }
  }

  /**
   * Writes data to a file.
   *
   * @param {string} filePath - The path of the file to write to.
   * @param {string} data - The data to write to the file.
   * @returns {Promise<void>} - A promise that resolves when the data is successfully written to the file.
   */
  private async writeFile(filePath: string, data: string): Promise<void> {
    try {
      await fs.writeFile(`${filePath}`, data, 'utf8');
      this.log.debug(`Successfully wrote to ${filePath}`);
    } catch (error) {
      this.log.error(`Error writing to ${filePath}:`, error);
    }
  }

  /**
   * Starts a plugin.
   *
   * @param {RegisteredPlugin} plugin - The plugin to start.
   * @param {string} [message] - Optional message to pass to the plugin's onStart method.
   * @param {boolean} [configure] - Indicates whether to configure the plugin after starting (default false).
   * @returns {Promise<void>} A promise that resolves when the plugin is started successfully, or rejects with an error if starting the plugin fails.
   */
  private async startPlugin(plugin: RegisteredPlugin, message?: string, configure = false): Promise<void> {
    if (!plugin.loaded || !plugin.platform) {
      this.log.error(`Plugin ${plg}${plugin.name}${er} not loaded or no platform`);
      return Promise.resolve();
    }
    if (plugin.started) {
      this.log.debug(`Plugin ${plg}${plugin.name}${db} already started`);
      return Promise.resolve();
    }
    this.log.info(`Starting plugin ${plg}${plugin.name}${db} type ${typ}${plugin.type}${db}`);
    try {
      plugin.platform
        .onStart(message)
        .then(() => {
          plugin.started = true;
          this.log.info(`Started plugin ${plg}${plugin.name}${db} type ${typ}${plugin.type}${db}`);
          if (configure) this.configurePlugin(plugin); // No await do it asyncronously
          return Promise.resolve();
        })
        .catch((err) => {
          plugin.error = true;
          this.log.error(`Failed to start plugin ${plg}${plugin.name}${er}: ${err}`);
          return Promise.resolve();
        });
    } catch (err) {
      plugin.error = true;
      this.log.error(`Failed to start plugin ${plg}${plugin.name}${er}: ${err}`);
      return Promise.resolve();
    }
  }

  /**
   * Configures a plugin.
   *
   * @param {RegisteredPlugin} plugin - The plugin to configure.
   * @returns {Promise<void>} A promise that resolves when the plugin is configured successfully, or rejects with an error if configuration fails.
   */
  private async configurePlugin(plugin: RegisteredPlugin): Promise<void> {
    if (!plugin.loaded || !plugin.started || !plugin.platform) {
      this.log.error(`Plugin ${plg}${plugin.name}${er} not loaded (${plugin.loaded}) or not started (${plugin.started}) or not platform (${plugin.platform?.name})`);
      return Promise.resolve();
    }
    if (plugin.configured) {
      this.log.info(`Plugin ${plg}${plugin.name}${nf} already configured`);
      return Promise.resolve();
    }
    this.log.info(`Configuring plugin ${plg}${plugin.name}${db} type ${typ}${plugin.type}${db}`);
    try {
      plugin.platform
        .onConfigure()
        .then(() => {
          plugin.configured = true;
          this.log.info(`Configured plugin ${plg}${plugin.name}${db} type ${typ}${plugin.type}${db}`);
          this.savePluginConfig(plugin);
          return Promise.resolve();
        })
        .catch((err) => {
          plugin.error = true;
          this.log.error(`Failed to configure plugin ${plg}${plugin.name}${er}: ${err}`);
          return Promise.resolve();
        });
    } catch (err) {
      plugin.error = true;
      this.log.error(`Failed to configure plugin ${plg}${plugin.name}${er}: ${err}`);
      return Promise.resolve();
    }
  }

  /**
   * Loads and parse the plugin package.json and returns it.
   * @param plugin - The plugin to load the package from.
   * @returns A Promise that resolves to the package.json object or undefined if the package.json could not be loaded.
   */
  private async parsePlugin(plugin: RegisteredPlugin): Promise<Record<string, string | number | object> | undefined> {
    this.log.debug(`Parsing package.json of plugin ${plg}${plugin.name}${nf} type ${typ}${plugin.type}${nf}`);
    try {
      const packageJson = JSON.parse(await fs.readFile(plugin.path, 'utf8'));
      return packageJson;
    } catch (err) {
      this.log.error(`Failed to parse plugin ${plg}${plugin.name}${er} package.json: ${err}`);
      plugin.error = true;
      return undefined;
    }
  }

  /**
   * Loads a plugin and returns the corresponding MatterbridgePlatform instance.
   * @param plugin - The plugin to load.
   * @param start - Optional flag indicating whether to start the plugin after loading. Default is false.
   * @param message - Optional message to pass to the plugin when starting.
   * @returns A Promise that resolves to the loaded MatterbridgePlatform instance.
   * @throws An error if the plugin is not enabled, already loaded, or fails to load.
   */
  private async loadPlugin(plugin: RegisteredPlugin, start = false, message = ''): Promise<MatterbridgePlatform | undefined> {
    if (!plugin.enabled) {
      this.log.error(`Plugin ${plg}${plugin.name}${er} not enabled`);
      return Promise.resolve(undefined);
    }
    if (plugin.platform) {
      this.log.error(`Plugin ${plg}${plugin.name}${er} already loaded`);
      return Promise.resolve(plugin.platform);
    }
    this.log.info(`Loading plugin ${plg}${plugin.name}${nf} type ${typ}${plugin.type}${nf}`);
    try {
      // Load the package.json of the plugin
      const packageJson = JSON.parse(await fs.readFile(plugin.path, 'utf8'));
      // Resolve the main module path relative to package.json
      const pluginEntry = path.resolve(path.dirname(plugin.path), packageJson.main);
      // Dynamically import the plugin
      const pluginUrl = pathToFileURL(pluginEntry);
      this.log.debug(`Importing plugin ${plg}${plugin.name}${db} from ${pluginUrl.href}`);
      const pluginInstance = await import(pluginUrl.href);
      this.log.debug(`Imported plugin ${plg}${plugin.name}${db} from ${pluginUrl.href}`);

      // Call the default export function of the plugin, passing this MatterBridge instance, the log and the config
      if (pluginInstance.default) {
        const config: PlatformConfig = await this.loadPluginConfig(plugin);
        const log = new AnsiLogger({ logName: plugin.description, logTimestampFormat: TimestampFormat.TIME_MILLIS, logDebug: (config.debug as boolean) ?? false });
        const platform = pluginInstance.default(this, log, config) as MatterbridgePlatform;
        platform.name = packageJson.name;
        platform.config = config;
        platform.version = packageJson.version;
        plugin.name = packageJson.name;
        plugin.description = packageJson.description;
        plugin.version = packageJson.version;
        plugin.author = packageJson.author;
        plugin.type = platform.type;
        plugin.platform = platform;
        plugin.loaded = true;
        plugin.registeredDevices = 0;
        plugin.addedDevices = 0;
        plugin.configJson = config;
        plugin.schemaJson = await this.loadPluginSchema(plugin);
        // Save the updated plugin data in the node storage
        await this.nodeContext?.set<RegisteredPlugin[]>('plugins', await this.getBaseRegisteredPlugins());

        // this.getPluginLatestVersion(plugin); moved to parseCommandLine

        this.log.info(`Loaded plugin ${plg}${plugin.name}${nf} type ${typ}${platform.type} ${db}(entrypoint ${UNDERLINE}${pluginEntry}${UNDERLINEOFF})`);
        if (start) this.startPlugin(plugin, message); // No await do it asyncronously
        return Promise.resolve(platform);
      } else {
        this.log.error(`Plugin ${plg}${plugin.name}${er} does not provide a default export`);
        plugin.error = true;
        return Promise.resolve(undefined);
      }
    } catch (err) {
      this.log.error(`Failed to load plugin ${plg}${plugin.name}${er}: ${err}`);
      plugin.error = true;
      return Promise.resolve(undefined);
    }
  }

  /**
   * Starts the Matterbridge controller.
   * @private
   * @returns {Promise<void>} A promise that resolves when the Matterbridge is started.
   */
  private async startMattercontroller(): Promise<void> {
    if (!this.storageManager) {
      this.log.error('No storage manager initialized');
      await this.cleanup('No storage manager initialized');
      return;
    }
    this.log.info('Creating context: mattercontrollerContext');
    this.mattercontrollerContext = this.storageManager.createContext('mattercontrollerContext');
    if (!this.mattercontrollerContext) {
      this.log.error('No storage context mattercontrollerContext initialized');
      await this.cleanup('No storage context mattercontrollerContext initialized');
      return;
    }

    this.log.debug('Starting matterbridge in mode', this.bridgeMode);
    this.matterServer = this.createMatterServer(this.storageManager);
    this.log.info('Creating matter commissioning controller');
    this.commissioningController = new CommissioningController({
      autoConnect: false,
    });
    this.log.info('Adding matter commissioning controller to matter server');
    await this.matterServer.addCommissioningController(this.commissioningController);

    this.log.info('Starting matter server');
    await this.matterServer.start();
    this.log.info('Matter server started');

    if (hasParameter('pairingcode')) {
      this.log.info('Pairing device with pairingcode:', getParameter('pairingcode'));
      const pairingCode = getParameter('pairingcode');
      const ip = this.mattercontrollerContext.has('ip') ? this.mattercontrollerContext.get<string>('ip') : undefined;
      const port = this.mattercontrollerContext.has('port') ? this.mattercontrollerContext.get<number>('port') : undefined;

      let longDiscriminator, setupPin, shortDiscriminator;
      if (pairingCode !== undefined) {
        const pairingCodeCodec = ManualPairingCodeCodec.decode(pairingCode);
        shortDiscriminator = pairingCodeCodec.shortDiscriminator;
        longDiscriminator = undefined;
        setupPin = pairingCodeCodec.passcode;
        this.log.info(`Data extracted from pairing code: ${Logger.toJSON(pairingCodeCodec)}`);
      } else {
        longDiscriminator = await this.mattercontrollerContext.get('longDiscriminator', 3840);
        if (longDiscriminator > 4095) throw new Error('Discriminator value must be less than 4096');
        setupPin = this.mattercontrollerContext.get('pin', 20202021);
      }
      if ((shortDiscriminator === undefined && longDiscriminator === undefined) || setupPin === undefined) {
        throw new Error('Please specify the longDiscriminator of the device to commission with -longDiscriminator or provide a valid passcode with -passcode');
      }

      const commissioningOptions: CommissioningOptions = {
        regulatoryLocation: GeneralCommissioning.RegulatoryLocationType.IndoorOutdoor,
        regulatoryCountryCode: 'XX',
      };
      const options = {
        commissioning: commissioningOptions,
        discovery: {
          knownAddress: ip !== undefined && port !== undefined ? { ip, port, type: 'udp' } : undefined,
          identifierData: longDiscriminator !== undefined ? { longDiscriminator } : shortDiscriminator !== undefined ? { shortDiscriminator } : {},
        },
        passcode: setupPin,
      } as NodeCommissioningOptions;
      this.log.info('Commissioning with options:', options);
      const nodeId = await this.commissioningController.commissionNode(options);
      this.log.info(`Commissioning successfully done with nodeId: ${nodeId.nodeId}`);
      this.log.info('ActiveSessionInformation:', this.commissioningController.getActiveSessionInformation());
    } // (hasParameter('pairingcode'))

    if (hasParameter('unpairall')) {
      this.log.info('***Commissioning controller unpairing all nodes...');
      const nodeIds = this.commissioningController.getCommissionedNodes();
      for (const nodeId of nodeIds) {
        this.log.info('***Commissioning controller unpairing node:', nodeId);
        await this.commissioningController.removeNode(nodeId);
      }
      return;
    }

    if (hasParameter('discover')) {
      // const discover = await this.commissioningController.discoverCommissionableDevices({ productId: 0x8000, deviceType: 0xfff1 });
      // console.log(discover);
    }

    if (!this.commissioningController.isCommissioned()) {
      this.log.info('***Commissioning controller is not commissioned: use matterbridge -controller -pairingcode [pairingcode] to commission a device');
      return;
    }

    const nodeIds = this.commissioningController.getCommissionedNodes();
    this.log.info(`***Commissioning controller is commissioned ${this.commissioningController.isCommissioned()} and has ${nodeIds.length} nodes commisioned: `);
    for (const nodeId of nodeIds) {
      this.log.info(`***Connecting to commissioned node: ${nodeId}`);

      const node = await this.commissioningController.connectNode(nodeId, {
        autoSubscribe: false,
        attributeChangedCallback: (peerNodeId, { path: { nodeId, clusterId, endpointId, attributeName }, value }) =>
          this.log.info(`***Commissioning controller attributeChangedCallback ${peerNodeId}: attribute ${nodeId}/${endpointId}/${clusterId}/${attributeName} changed to ${Logger.toJSON(value)}`),
        eventTriggeredCallback: (peerNodeId, { path: { nodeId, clusterId, endpointId, eventName }, events }) =>
          this.log.info(`***Commissioning controller eventTriggeredCallback ${peerNodeId}: Event ${nodeId}/${endpointId}/${clusterId}/${eventName} triggered with ${Logger.toJSON(events)}`),
        stateInformationCallback: (peerNodeId, info) => {
          switch (info) {
            case NodeStateInformation.Connected:
              this.log.info(`***Commissioning controller stateInformationCallback ${peerNodeId}: Node ${nodeId} connected`);
              break;
            case NodeStateInformation.Disconnected:
              this.log.info(`***Commissioning controller stateInformationCallback ${peerNodeId}: Node ${nodeId} disconnected`);
              break;
            case NodeStateInformation.Reconnecting:
              this.log.info(`***Commissioning controller stateInformationCallback ${peerNodeId}: Node ${nodeId} reconnecting`);
              break;
            case NodeStateInformation.WaitingForDeviceDiscovery:
              this.log.info(`***Commissioning controller stateInformationCallback ${peerNodeId}: Node ${nodeId} waiting for device discovery`);
              break;
            case NodeStateInformation.StructureChanged:
              this.log.info(`***Commissioning controller stateInformationCallback ${peerNodeId}: Node ${nodeId} structure changed`);
              break;
            case NodeStateInformation.Decommissioned:
              this.log.info(`***Commissioning controller stateInformationCallback ${peerNodeId}: Node ${nodeId} decommissioned`);
              break;
            default:
              this.log.info(`***Commissioning controller stateInformationCallback ${peerNodeId}: Node ${nodeId} NodeStateInformation.${info}`);
              break;
          }
        },
      });

      node.logStructure();

      // Get the interaction client
      this.log.info('Getting the interaction client');
      const interactionClient = await node.getInteractionClient();
      let cluster;
      let attributes;

      // Log BasicInformationCluster
      cluster = BasicInformationCluster;
      attributes = await interactionClient.getMultipleAttributes({
        attributes: [{ clusterId: cluster.id }],
      });
      if (attributes.length > 0) this.log.info(`Cluster: ${idn}${cluster.name}${rs}${nf} attributes:`);
      attributes.forEach((attribute) => {
        this.log.info(
          `- endpoint ${or}${attribute.path.endpointId}${nf} cluster ${hk}${getClusterNameById(attribute.path.clusterId)}${nf} (${hk}0x${attribute.path.clusterId.toString(16)}${nf}) attribute ${zb}${attribute.path.attributeName}${nf} (${zb}0x${attribute.path.attributeId.toString(16)}${nf}): ${typeof attribute.value === 'object' ? stringify(attribute.value) : attribute.value}`,
        );
      });

      // Log PowerSourceCluster
      cluster = PowerSourceCluster;
      attributes = await interactionClient.getMultipleAttributes({
        attributes: [{ clusterId: cluster.id }],
      });
      if (attributes.length > 0) this.log.info(`Cluster: ${idn}${cluster.name}${rs}${nf} attributes:`);
      attributes.forEach((attribute) => {
        this.log.info(
          `- endpoint ${or}${attribute.path.endpointId}${nf} cluster ${hk}${getClusterNameById(attribute.path.clusterId)}${nf} (${hk}0x${attribute.path.clusterId.toString(16)}${nf}) attribute ${zb}${attribute.path.attributeName}${nf} (${zb}0x${attribute.path.attributeId.toString(16)}${nf}): ${typeof attribute.value === 'object' ? stringify(attribute.value) : attribute.value}`,
        );
      });

      // Log ThreadNetworkDiagnostics
      cluster = ThreadNetworkDiagnosticsCluster;
      attributes = await interactionClient.getMultipleAttributes({
        attributes: [{ clusterId: cluster.id }],
      });
      if (attributes.length > 0) this.log.info(`Cluster: ${idn}${cluster.name}${rs}${nf} attributes:`);
      attributes.forEach((attribute) => {
        this.log.info(
          `- endpoint ${or}${attribute.path.endpointId}${nf} cluster ${hk}${getClusterNameById(attribute.path.clusterId)}${nf} (${hk}0x${attribute.path.clusterId.toString(16)}${nf}) attribute ${zb}${attribute.path.attributeName}${nf} (${zb}0x${attribute.path.attributeId.toString(16)}${nf}): ${typeof attribute.value === 'object' ? stringify(attribute.value) : attribute.value}`,
        );
      });

      // Log SwitchCluster
      cluster = SwitchCluster;
      attributes = await interactionClient.getMultipleAttributes({
        attributes: [{ clusterId: cluster.id }],
      });
      if (attributes.length > 0) this.log.info(`Cluster: ${idn}${cluster.name}${rs}${nf} attributes:`);
      attributes.forEach((attribute) => {
        this.log.info(
          `- endpoint ${or}${attribute.path.endpointId}${nf} cluster ${hk}${getClusterNameById(attribute.path.clusterId)}${nf} (${hk}0x${attribute.path.clusterId.toString(16)}${nf}) attribute ${zb}${attribute.path.attributeName}${nf} (${zb}0x${attribute.path.attributeId.toString(16)}${nf}): ${typeof attribute.value === 'object' ? stringify(attribute.value) : attribute.value}`,
        );
      });

      this.log.info('Subscribing to all attributes and events');
      await node.subscribeAllAttributesAndEvents({
        ignoreInitialTriggers: false,
        attributeChangedCallback: ({ path: { nodeId, clusterId, endpointId, attributeName }, version, value }) =>
          this.log.info(
            `***${db}Commissioning controller attributeChangedCallback version ${version}: attribute ${BLUE}${nodeId}${db}/${or}${endpointId}${db}/${hk}${getClusterNameById(clusterId)}${db}/${zb}${attributeName}${db} changed to ${typeof value === 'object' ? debugStringify(value ?? { none: true }) : value}`,
          ),
        eventTriggeredCallback: ({ path: { nodeId, clusterId, endpointId, eventName }, events }) => {
          this.log.info(
            `***${db}Commissioning controller eventTriggeredCallback: event ${BLUE}${nodeId}${db}/${or}${endpointId}${db}/${hk}${getClusterNameById(clusterId)}${db}/${zb}${eventName}${db} triggered with ${debugStringify(events ?? { none: true })}`,
          );
        },
      });
      this.log.info('Subscribed to all attributes and events');
    }
  }

  /**
   * Starts the Matterbridge based on the bridge mode.
   * If the bridge mode is 'bridge', it creates a commissioning server, matter aggregator,
   * and starts the matter server.
   * If the bridge mode is 'childbridge', it starts the plugins, creates commissioning servers,
   * and starts the matter server when all plugins are loaded and started.
   * @private
   * @returns {Promise<void>} A promise that resolves when the Matterbridge is started.
   */
  private async startMatterbridge(): Promise<void> {
    if (this.bridgeMode === 'bridge') {
      // Plugins are loaded and started by loadPlugin on startup and plugin.loaded and plugin.loaded are set to true
      // Plugins are configured by callback when Matterbridge is commissioned and plugin.configured is set to true
      this.log.debug('***Starting startMatterbridge interval for Matterbridge');
      let failCount = 0;
      const startMatterInterval = setInterval(async () => {
        for (const plugin of this.registeredPlugins) {
          // new code to not start the bridge if one plugin is in error cause the controllers will delete the devices loosing all the configuration
          if (!plugin.enabled) continue;
          if (plugin.error) {
            clearInterval(startMatterInterval);
            this.log.debug('***Cleared startMatterInterval interval for Matterbridge for plugin in error state');
            this.log.error(`The plugin ${plg}${plugin.name}${er} is in error state.`);
            this.log.error('The bridge will not start until the problem is solved to prevent the controllers from deleting all registered devices.');
            this.log.error('If you want to start the bridge disable the plugin in error state and restart.');
            return;
          }

          if (!plugin.loaded || !plugin.started) {
            this.log.debug(`***Waiting (failSafeCount=${failCount}/30) in startMatterInterval interval for plugin ${plg}${plugin.name}${db} loaded: ${plugin.loaded} started: ${plugin.started}...`);
            failCount++;
            if (failCount > 30) {
              this.log.error(`Error waiting for plugin ${plg}${plugin.name}${er} to load and start. Plugin is in error state.`);
              plugin.error = true;
            }
            return;
          }
        }
        clearInterval(startMatterInterval);
        this.log.debug('***Cleared startMatterInterval interval for Matterbridge');

        await this.startMatterServer();
        this.log.info('Matter server started');

        // Configure the plugins
        /*
        for (const plugin of this.registeredPlugins) {
          if (!plugin.enabled || !plugin.loaded || !plugin.started || plugin.error) continue;
          try {
            this.configurePlugin(plugin); // No await do it asyncronously
          } catch (error) {
            plugin.error = true;
            this.log.error(`Error configuring plugin ${plg}${plugin.name}${er}`, error);
          }
        }
        */

        // Show the QR code for commissioning or log the already commissioned message
        await this.showCommissioningQRCode(this.commissioningServer, this.matterbridgeContext, this.nodeContext, 'Matterbridge');

        // Setting reachability to true
        setTimeout(() => {
          this.log.info(`Setting reachability to true for ${plg}Matterbridge${db}`);
          if (this.commissioningServer) this.setCommissioningServerReachability(this.commissioningServer, true);
          if (this.matterAggregator) this.setAggregatorReachability(this.matterAggregator, true);
        }, 60 * 1000);
      }, 1000);
    }

    if (this.bridgeMode === 'childbridge') {
      // Plugins are loaded and started by loadPlugin on startup
      // addDevice and addBridgedDeevice create the commissionig servers and add the devices to the the commissioning server or to the aggregator
      // Plugins are configured by callback when the plugin is commissioned

      // Start the interval to check if all plugins are loaded and started and so start the matter server
      this.log.debug('***Starting start matter interval in childbridge mode...');
      let failCount = 0;
      const startMatterInterval = setInterval(async () => {
        let allStarted = true;
        for (const plugin of this.registeredPlugins) {
          // new code to not start the bridge if one plugin is in error cause the controllers will delete the devices loosing all the configuration
          if (!plugin.enabled) continue;
          if (plugin.error) {
            clearInterval(startMatterInterval);
            this.log.debug('***Cleared startMatterInterval interval for Matterbridge for plugin in error state');
            this.log.error(`The plugin ${plg}${plugin.name}${er} is in error state.`);
            this.log.error('The bridge will not start until the problem is solved to prevent the controllers from deleting all registered devices.');
            this.log.error('If you want to start the bridge disable the plugin in error state and restart.');
            return;
          }

          this.log.debug(`***Checking plugin ${plg}${plugin.name}${db} to start matter in childbridge mode...`);
          if (!plugin.loaded || !plugin.started) {
            allStarted = false;
            this.log.debug(`***Waiting (failSafeCount=${failCount}/30) for plugin ${plg}${plugin.name}${db} to load (${plugin.loaded}) and start (${plugin.started}) ...`);
            failCount++;
            if (failCount > 30) {
              this.log.error(`Error waiting for plugin ${plg}${plugin.name}${er} to load and start. Plugin is in error mode.`);
              plugin.error = true;
            }
          }
        }
        if (!allStarted) return;
        clearInterval(startMatterInterval);
        this.log.debug('***Cleared startMatterInterval interval in childbridge mode');

        await this.startMatterServer();
        this.log.info('Matter server started');
        for (const plugin of this.registeredPlugins) {
          if (!plugin.enabled || plugin.error) continue;
          if (!plugin.addedDevices || plugin.addedDevices === 0) {
            this.log.error(`Plugin ${plg}${plugin.name}${er} didn't add any devices to Matterbridge. Verify the plugin configuration.`);
            continue;
          }
          if (!plugin.commissioningServer) {
            this.log.error(`Commissioning server not found for plugin ${plg}${plugin.name}${er}`);
            continue;
          }
          if (!plugin.storageContext) {
            this.log.error(`Storage context not found for plugin ${plg}${plugin.name}${er}`);
            continue;
          }
          if (!plugin.nodeContext) {
            this.log.error(`Node storage context not found for plugin ${plg}${plugin.name}${er}`);
            continue;
          }
          await this.showCommissioningQRCode(plugin.commissioningServer, plugin.storageContext, plugin.nodeContext, plugin.name);
          // Setting reachability to true
          setTimeout(() => {
            this.log.info(`Setting reachability to true for ${plg}${plugin.name}${db}`);
            if (plugin.commissioningServer) this.setCommissioningServerReachability(plugin.commissioningServer, true);
            if (plugin.type === 'AccessoryPlatform' && plugin.device) this.setDeviceReachability(plugin.device, true);
            if (plugin.type === 'DynamicPlatform' && plugin.aggregator) this.setAggregatorReachability(plugin.aggregator, true);
          }, 60 * 1000);
        }
      }, 1000);
    }
  }

  /**
   * Starts the Matter server.
   * If the Matter server is not initialized, it logs an error and performs cleanup.
   */
  private async startMatterServer() {
    if (!this.matterServer) {
      this.log.error('No matter server initialized');
      await this.cleanup('No matter server initialized');
      return;
    }
    this.log.debug('Starting matter server...');
    await this.matterServer.start();
    this.log.debug('Started matter server');
    // this.commissioningServer?.getRootEndpoint() && logEndpoint(this.commissioningServer?.getRootEndpoint());
  }

  /**
   * Imports the commissioning server context for a specific plugin and device.
   * @param pluginName - The name of the plugin.
   * @param device - The MatterbridgeDevice object representing the device.
   * @returns The commissioning server context.
   * @throws Error if the BasicInformationCluster is not found.
   */
  private async importCommissioningServerContext(pluginName: string, device: MatterbridgeDevice) {
    this.log.debug(`Importing matter commissioning server storage context from device for ${plg}${pluginName}${db}`);
    const basic = device.getClusterServer(BasicInformationCluster);
    if (!basic) {
      this.log.error('importCommissioningServerContext error: cannot find the BasicInformationCluster');
      process.exit(1);
    }
    if (!this.storageManager) {
      this.log.error('importCommissioningServerContext error: no storage manager initialized');
      process.exit(1);
    }

    this.log.debug(`Importing commissioning server storage context for ${plg}${pluginName}${db}`);
    const storageContext = this.storageManager.createContext(pluginName);
    await storageContext.set('deviceName', basic.getNodeLabelAttribute());
    await storageContext.set('deviceType', DeviceTypeId(device.deviceType));
    await storageContext.set('vendorId', basic.getVendorIdAttribute());
    await storageContext.set('vendorName', basic.getVendorNameAttribute());
    await storageContext.set('productId', basic.getProductIdAttribute());
    await storageContext.set('productName', basic.getProductNameAttribute());
    await storageContext.set('nodeLabel', basic.getNodeLabelAttribute());
    await storageContext.set('productLabel', basic.getNodeLabelAttribute());
    await storageContext.set('serialNumber', basic.attributes.serialNumber?.getLocal());
    await storageContext.set('uniqueId', basic.attributes.uniqueId?.getLocal());
    await storageContext.set('softwareVersion', basic.getSoftwareVersionAttribute());
    await storageContext.set('softwareVersionString', basic.getSoftwareVersionStringAttribute());
    await storageContext.set('hardwareVersion', basic.getHardwareVersionAttribute());
    await storageContext.set('hardwareVersionString', basic.getHardwareVersionStringAttribute());

    this.log.debug(`Imported commissioning server storage context for ${plg}${pluginName}${db}`);
    this.log.debug(`- deviceName: ${await storageContext.get('deviceName')} deviceType: ${await storageContext.get('deviceType')}(0x${(await storageContext.get('deviceType'))?.toString(16).padStart(4, '0')})`);
    this.log.debug(`- serialNumber: ${await storageContext.get('serialNumber')} uniqueId: ${await storageContext.get('uniqueId')}`);
    this.log.debug(`- softwareVersion: ${await storageContext.get('softwareVersion')} softwareVersionString: ${await storageContext.get('softwareVersionString')}`);
    this.log.debug(`- hardwareVersion: ${await storageContext.get('hardwareVersion')} hardwareVersionString: ${await storageContext.get('hardwareVersionString')}`);
    return storageContext;
  }

  /**
   * Creates a commissioning server storage context.
   *
   * @param pluginName - The name of the plugin.
   * @param deviceName - The name of the device.
   * @param deviceType - The type of the device.
   * @param vendorId - The vendor ID.
   * @param vendorName - The vendor name.
   * @param productId - The product ID.
   * @param productName - The product name.
   * @param serialNumber - The serial number of the device (optional).
   * @param uniqueId - The unique ID of the device (optional).
   * @param softwareVersion - The software version of the device (optional).
   * @param softwareVersionString - The software version string of the device (optional).
   * @param hardwareVersion - The hardware version of the device (optional).
   * @param hardwareVersionString - The hardware version string of the device (optional).
   * @returns The storage context for the commissioning server.
   */
  private async createCommissioningServerContext(pluginName: string, deviceName: string, deviceType: DeviceTypeId, vendorId: number, vendorName: string, productId: number, productName: string) {
    if (!this.storageManager) {
      this.log.error('No storage manager initialized');
      process.exit(1);
    }
    this.log.debug(`Creating commissioning server storage context for ${plg}${pluginName}${db}`);
    const random = 'CS' + CryptoNode.getRandomData(8).toHex();
    const storageContext = this.storageManager.createContext(pluginName);
    await storageContext.set('deviceName', deviceName);
    await storageContext.set('deviceType', deviceType);
    await storageContext.set('vendorId', vendorId);
    await storageContext.set('vendorName', vendorName.slice(0, 32));
    await storageContext.set('productId', productId);
    await storageContext.set('productName', productName.slice(0, 32));
    await storageContext.set('nodeLabel', productName.slice(0, 32));
    await storageContext.set('productLabel', productName.slice(0, 32));
    await storageContext.set('serialNumber', await storageContext.get('serialNumber', random));
    await storageContext.set('uniqueId', await storageContext.get('uniqueId', random));
    await storageContext.set('softwareVersion', this.matterbridgeVersion && this.matterbridgeVersion.includes('.') ? parseInt(this.matterbridgeVersion.split('.')[0], 10) : 1);
    await storageContext.set('softwareVersionString', this.matterbridgeVersion ?? '1.0.0');
    await storageContext.set('hardwareVersion', this.systemInformation.osRelease && this.systemInformation.osRelease.includes('.') ? parseInt(this.systemInformation.osRelease.split('.')[0], 10) : 1);
    await storageContext.set('hardwareVersionString', this.systemInformation.osRelease ?? '1.0.0');

    this.log.debug(`Created commissioning server storage context for ${plg}${pluginName}${db}`);
    this.log.debug(`- deviceName: ${await storageContext.get('deviceName')} deviceType: ${await storageContext.get('deviceType')}(0x${(await storageContext.get('deviceType'))?.toString(16).padStart(4, '0')})`);
    this.log.debug(`- serialNumber: ${await storageContext.get('serialNumber')} uniqueId: ${await storageContext.get('uniqueId')}`);
    this.log.debug(`- softwareVersion: ${await storageContext.get('softwareVersion')} softwareVersionString: ${await storageContext.get('softwareVersionString')}`);
    this.log.debug(`- hardwareVersion: ${await storageContext.get('hardwareVersion')} hardwareVersionString: ${await storageContext.get('hardwareVersionString')}`);
    return storageContext;
  }

  /**
   * Shows the commissioning QR code for a given plugin.
   * @param {CommissioningServer} commissioningServer - The commissioning server instance.
   * @param {StorageContext} storageContext - The storage context instance.
   * @param {NodeStorage} nodeContext - The node storage instance.
   * @param {string} pluginName - The name of the plugin.
   * @returns {Promise<void>} - A promise that resolves when the QR code is shown.
   */
  private async showCommissioningQRCode(commissioningServer: CommissioningServer | undefined, storageContext: StorageContext | undefined, nodeContext: NodeStorage | undefined, pluginName: string) {
    if (!commissioningServer || !storageContext || !nodeContext || !pluginName) {
      this.log.error(`showCommissioningQRCode error: commissioningServer: ${!commissioningServer} storageContext: ${!storageContext} nodeContext: ${!nodeContext} pluginName: ${pluginName}`);
      await this.cleanup('No storage initialized in showCommissioningQRCode');
      return;
    }
    if (!commissioningServer.isCommissioned()) {
      const { qrPairingCode, manualPairingCode } = commissioningServer.getPairingCode();
      await storageContext.set('qrPairingCode', qrPairingCode);
      await storageContext.set('manualPairingCode', manualPairingCode);
      await nodeContext.set<string>('qrPairingCode', qrPairingCode);
      await nodeContext.set<string>('manualPairingCode', manualPairingCode);
      const QrCode = new QrCodeSchema();
      this.log.info(
        `***The commissioning server on port ${commissioningServer.getPort()} for ${plg}${pluginName}${nf} is not commissioned. Pair it scanning the QR code:\n\n` +
          `${QrCode.encode(qrPairingCode)}\n${plg}${pluginName}${nf}\n\nqrPairingCode: ${qrPairingCode}\n\nManual pairing code: ${manualPairingCode}\n`,
      );
      if (pluginName === 'Matterbridge') {
        this.matterbridgeFabricInformations = [];
        this.matterbridgeSessionInformations = [];
        this.matterbridgePaired = false;
        this.matterbridgeConnected = false;
      }
      if (pluginName !== 'Matterbridge') {
        const plugin = this.findPlugin(pluginName);
        if (plugin) {
          plugin.qrPairingCode = qrPairingCode;
          plugin.manualPairingCode = manualPairingCode;
          plugin.fabricInformations = [];
          plugin.sessionInformations = [];
          plugin.paired = false;
          plugin.connected = false;
        }
      }
      await this.nodeContext?.set<RegisteredPlugin[]>('plugins', await this.getBaseRegisteredPlugins());
    } else {
      this.log.info(`*The commissioning server on port ${commissioningServer.getPort()} for ${plg}${pluginName}${nf} is already commissioned. Waiting for controllers to connect ...`);
      const fabricInfo = commissioningServer.getCommissionedFabricInformation();
      if (fabricInfo.length > 0) this.log.info('Commissioned fabric information:');
      fabricInfo?.forEach((info) => {
        this.log.info(`- fabric index ${zb}${info.fabricIndex}${nf} id ${zb}${info.fabricId}${nf} vendor ${zb}${info.rootVendorId}${nf} ${this.getVendorIdName(info.rootVendorId)} ${info.label}`);
      });
      if (pluginName === 'Matterbridge') {
        this.matterbridgeFabricInformations = this.sanitizeFabricInformations(fabricInfo);
        this.matterbridgeSessionInformations = [];
        this.matterbridgePaired = true;
      }
      if (pluginName !== 'Matterbridge') {
        const plugin = this.findPlugin(pluginName);
        if (plugin) {
          plugin.fabricInformations = this.sanitizeFabricInformations(fabricInfo);
          plugin.sessionInformations = [];
          plugin.paired = true;
        }
      }
      await this.nodeContext?.set<RegisteredPlugin[]>('plugins', await this.getBaseRegisteredPlugins());
    }
  }

  /**
   * Sanitizes the fabric information by converting bigint properties to string cause res..
   *
   * @param fabricInfo - The array of exposed fabric information objects.
   * @returns An array of sanitized exposed fabric information objects.
   */
  private sanitizeFabricInformations(fabricInfo: ExposedFabricInformation[]) {
    return fabricInfo.map((info) => {
      return {
        fabricIndex: info.fabricIndex,
        fabricId: info.fabricId.toString(),
        nodeId: info.nodeId.toString(),
        rootNodeId: info.rootNodeId.toString(),
        rootVendorId: info.rootVendorId,
        rootVendorName: this.getVendorIdName(info.rootVendorId),
        label: info.label,
      } as SanitizedExposedFabricInformation;
    });
  }

  /**
   * Sanitizes the session information by converting bigint properties to string.
   *
   * @param sessionInfo - The array of session information objects.
   * @returns An array of sanitized session information objects.
   */
  private sanitizeSessionInformation(sessionInfo: SessionInformation[]) {
    return sessionInfo.map((info) => {
      return {
        name: info.name,
        nodeId: info.nodeId.toString(),
        peerNodeId: info.peerNodeId.toString(),
        fabric: info.fabric
          ? {
              fabricIndex: info.fabric.fabricIndex,
              fabricId: info.fabric.fabricId.toString(),
              nodeId: info.fabric.nodeId.toString(),
              rootNodeId: info.fabric.rootNodeId.toString(),
              rootVendorId: info.fabric.rootVendorId,
              rootVendorName: this.getVendorIdName(info.fabric.rootVendorId),
              label: info.fabric.label,
            }
          : undefined,
        isPeerActive: info.isPeerActive,
        secure: info.secure,
        lastInteractionTimestamp: info.lastInteractionTimestamp,
        lastActiveTimestamp: info.lastActiveTimestamp,
        numberOfActiveSubscriptions: info.numberOfActiveSubscriptions,
      } as SanitizedSessionInformation;
    });
  }

  /**
   * Finds a plugin by its name.
   *
   * @param pluginName - The name of the plugin to find.
   * @returns The found plugin, or undefined if not found.
   */
  private findPlugin(pluginName: string) {
    const plugin = this.registeredPlugins.find((registeredPlugin) => registeredPlugin.name === pluginName);
    if (!plugin) {
      this.log.error(`Plugin ${plg}${pluginName}${er} not found`);
      return;
    }
    return plugin;
  }

  /**
   * Sets the reachability of a commissioning server and trigger.
   *
   * @param {CommissioningServer} commissioningServer - The commissioning server to set the reachability for.
   * @param {boolean} reachable - The new reachability status.
   */
  private setCommissioningServerReachability(commissioningServer: CommissioningServer, reachable: boolean) {
    const basicInformationCluster = commissioningServer?.getRootClusterServer(BasicInformationCluster);
    if (basicInformationCluster && basicInformationCluster.attributes.reachable !== undefined) basicInformationCluster.setReachableAttribute(reachable);
    if (basicInformationCluster && basicInformationCluster.triggerReachableChangedEvent) basicInformationCluster.triggerReachableChangedEvent({ reachableNewValue: reachable });
  }

  /**
   * Sets the reachability of the specified matter aggregator and its bridged devices and trigger.
   * @param {Aggregator} matterAggregator - The matter aggregator to set the reachability for.
   * @param {boolean} reachable - A boolean indicating the reachability status to set.
   */
  private setAggregatorReachability(matterAggregator: Aggregator, reachable: boolean) {
    const basicInformationCluster = matterAggregator.getClusterServer(BasicInformationCluster);
    if (basicInformationCluster && basicInformationCluster.attributes.reachable !== undefined) basicInformationCluster.setReachableAttribute(reachable);
    if (basicInformationCluster && basicInformationCluster.triggerReachableChangedEvent) basicInformationCluster.triggerReachableChangedEvent({ reachableNewValue: reachable });
    matterAggregator.getBridgedDevices().forEach((device) => {
      this.log.debug(`Setting reachability to true for bridged device: ${dev}${device.name}${nf}`);
      device.getClusterServer(BridgedDeviceBasicInformationCluster)?.setReachableAttribute(reachable);
      device.getClusterServer(BridgedDeviceBasicInformationCluster)?.triggerReachableChangedEvent({ reachableNewValue: reachable });
    });
  }

  /**
   * Sets the reachability of a device and trigger.
   *
   * @param {MatterbridgeDevice} device - The device to set the reachability for.
   * @param {boolean} reachable - The new reachability status of the device.
   */
  private setDeviceReachability(device: MatterbridgeDevice, reachable: boolean) {
    const basicInformationCluster = device.getClusterServer(BasicInformationCluster);
    if (basicInformationCluster && basicInformationCluster.attributes.reachable !== undefined) basicInformationCluster.setReachableAttribute(reachable);
    if (basicInformationCluster && basicInformationCluster.triggerReachableChangedEvent) basicInformationCluster.triggerReachableChangedEvent({ reachableNewValue: reachable });
  }

  private getVendorIdName = (vendorId: number | undefined) => {
    if (!vendorId) return '';
    let vendorName = '';
    switch (vendorId) {
      case 4937:
        vendorName = '(AppleHome)';
        break;
      case 4996:
        vendorName = '(AppleKeyChain)';
        break;
      case 4362:
        vendorName = '(SmartThings)';
        break;
      case 4939:
        vendorName = '(HomeAssistant)';
        break;
      case 24582:
        vendorName = '(GoogleHome)';
        break;
      case 4631:
        vendorName = '(Alexa)';
        break;
      case 4701:
        vendorName = '(Tuya)';
        break;
      case 4742:
        vendorName = '(eWeLink)';
        break;
      case 65521:
        vendorName = '(PythonMatterServer)';
        break;
      default:
        vendorName = '(unknown)';
        break;
    }
    return vendorName;
  };

  /**
   * Creates a matter commissioning server.
   *
   * @param {StorageContext} context - The storage context.
   * @param {string} pluginName - The name of the commissioning server.
   * @returns {CommissioningServer} The created commissioning server.
   */
  private async createCommisioningServer(context: StorageContext, pluginName: string): Promise<CommissioningServer> {
    this.log.debug(`Creating matter commissioning server for plugin ${plg}${pluginName}${db}`);
    const deviceName = await context.get<string>('deviceName');
    const deviceType = await context.get<DeviceTypeId>('deviceType');

    const vendorId = await context.get<number>('vendorId');
    const vendorName = await context.get<string>('vendorName'); // Home app = Manufacturer

    const productId = await context.get<number>('productId');
    const productName = await context.get<string>('productName'); // Home app = Model

    const serialNumber = await context.get<string>('serialNumber');
    const uniqueId = await context.get<string>('uniqueId');

    const softwareVersion = await context.get<number>('softwareVersion', 1);
    const softwareVersionString = await context.get<string>('softwareVersionString', '1.0.0'); // Home app = Firmware Revision

    const hardwareVersion = await context.get<number>('hardwareVersion', 1);
    const hardwareVersionString = await context.get<string>('hardwareVersionString', '1.0.0');

    this.log.debug(`Creating matter commissioning server for plugin ${plg}${pluginName}${db} with deviceName '${deviceName}' deviceType ${deviceType}(0x${deviceType.toString(16).padStart(4, '0')})`);
    this.log.debug(`Creating matter commissioning server for plugin ${plg}${pluginName}${db} with uniqueId ${uniqueId} serialNumber ${serialNumber}`);
    this.log.debug(`Creating matter commissioning server for plugin ${plg}${pluginName}${db} with softwareVersion ${softwareVersion} softwareVersionString ${softwareVersionString}`);
    this.log.debug(`Creating matter commissioning server for plugin ${plg}${pluginName}${db} with hardwareVersion ${hardwareVersion} hardwareVersionString ${hardwareVersionString}`);
    this.log.debug(`Creating matter commissioning server for plugin ${plg}${pluginName}${db} with nodeLabel '${productName}' port ${this.port} passcode ${this.passcode} discriminator ${this.discriminator}`);
    const commissioningServer = new CommissioningServer({
      port: this.port++,
      // listeningAddressIpv4
      // listeningAddressIpv6
      passcode: this.passcode,
      discriminator: this.discriminator,
      deviceName,
      deviceType,
      basicInformation: {
        vendorId: VendorId(vendorId),
        vendorName,
        productId,
        productName,
        nodeLabel: productName,
        productLabel: productName,
        softwareVersion,
        softwareVersionString, // Home app = Firmware Revision
        hardwareVersion,
        hardwareVersionString,
        uniqueId,
        serialNumber,
        reachable: true,
      },
      activeSessionsChangedCallback: (fabricIndex) => {
        const sessionInformations: SessionInformation[] = commissioningServer.getActiveSessionInformation(fabricIndex);
        let connected = false;
        sessionInformations.forEach((session) => {
          this.log.info(
            `*Active session changed on fabric ${zb}${fabricIndex}${nf} id ${zb}${session.fabric?.fabricId}${nf} vendor ${zb}${session.fabric?.rootVendorId}${nf} ${this.getVendorIdName(session.fabric?.rootVendorId)} ${session.fabric?.label} for ${plg}${pluginName}${nf}`,
            debugStringify(session),
          );
          if (session.isPeerActive === true && session.secure === true && session.numberOfActiveSubscriptions >= 1) {
            this.log.info(`*Controller ${zb}${session.fabric?.rootVendorId}${nf} ${this.getVendorIdName(session.fabric?.rootVendorId)} ${session.fabric?.label} connected to ${plg}${pluginName}${nf} on session ${session.name}`);
            connected = true;
          }
        });
        if (connected) {
          if (this.bridgeMode === 'bridge') {
            this.matterbridgePaired = true;
            this.matterbridgeConnected = true;
            this.matterbridgeSessionInformations = this.sanitizeSessionInformation(sessionInformations);
          }
          if (this.bridgeMode === 'childbridge') {
            const plugin = this.findPlugin(pluginName);
            if (plugin) {
              plugin.paired = true;
              plugin.connected = true;
              plugin.sessionInformations = this.sanitizeSessionInformation(sessionInformations);
            }
          }

          setTimeout(() => {
            // We just need to configure the plugins after the controllers are connected
            if (this.bridgeMode === 'bridge') {
              for (const plugin of this.registeredPlugins) {
                if (!plugin.enabled || !plugin.loaded || !plugin.started || plugin.error) continue;
                try {
                  this.configurePlugin(plugin); // No await do it asyncronously
                } catch (error) {
                  plugin.error = true;
                  this.log.error(`Error configuring plugin ${plg}${plugin.name}${er}`, error);
                }
              }
            }
            if (this.bridgeMode === 'childbridge') {
              for (const plugin of this.registeredPlugins) {
                if (plugin.name === pluginName && plugin.loaded === true && plugin.started === true && plugin.configured !== true) {
                  try {
                    this.configurePlugin(plugin); // No await do it asyncronously
                  } catch (error) {
                    plugin.error = true;
                    this.log.error(`Error configuring plugin ${plg}${plugin.name}${er}`, error);
                  }
                }
              }
            }
            // logEndpoint(commissioningServer.getRootEndpoint());
          }, 2000);
        }
      },
      commissioningChangedCallback: async (fabricIndex) => {
        const fabricInfo = commissioningServer.getCommissionedFabricInformation(fabricIndex);
        this.log.debug(`*Commissioning changed on fabric ${zb}${fabricIndex}${nf} for ${plg}${pluginName}${nf}`, debugStringify(fabricInfo));
        if (commissioningServer.getCommissionedFabricInformation().length === 0) {
          this.log.warn(`*Commissioning removed from fabric ${zb}${fabricIndex}${nf} for ${plg}${pluginName}${wr}. Resetting the commissioning server ...`);
          await commissioningServer.factoryReset();
          if (pluginName === 'Matterbridge') {
            await this.matterbridgeContext?.clearAll();
            this.matterbridgeFabricInformations = [];
            this.matterbridgeSessionInformations = [];
            this.matterbridgePaired = false;
            this.matterbridgeConnected = false;
          } else {
            for (const plugin of this.registeredPlugins) {
              if (plugin.name === pluginName) {
                await plugin.platform?.onShutdown('Commissioning removed by the controller');
                plugin.fabricInformations = [];
                plugin.sessionInformations = [];
                plugin.paired = false;
                plugin.connected = false;
                await plugin.storageContext?.clearAll();
              }
            }
          }
          this.log.warn(`*Restart to activate the pairing for ${plg}${pluginName}${wr}.`);
        } else {
          const fabricInfo = commissioningServer.getCommissionedFabricInformation();
          if (pluginName === 'Matterbridge') {
            this.matterbridgeFabricInformations = this.sanitizeFabricInformations(fabricInfo);
            this.matterbridgePaired = true;
          } else {
            const plugin = this.findPlugin(pluginName);
            if (plugin) {
              plugin.fabricInformations = this.sanitizeFabricInformations(fabricInfo);
              plugin.paired = true;
            }
          }
        }
      },
    });
    if (this.passcode !== undefined) this.passcode++;
    if (this.discriminator !== undefined) this.discriminator++;

    commissioningServer.addCommandHandler('testEventTrigger', async ({ request: { enableKey, eventTrigger } }) => this.log.info(`testEventTrigger called on GeneralDiagnostic cluster: ${enableKey} ${eventTrigger}`));
    return commissioningServer;
  }

  /**
   * Creates a Matter server using the provided storage manager and the provided mdnsInterface.
   * @param storageManager The storage manager to be used by the Matter server.
   *
   */
  private createMatterServer(storageManager: StorageManager): MatterServer {
    this.log.debug('Creating matter server');

    // Validate mdnsInterface
    if (this.mdnsInterface) {
      const networkInterfaces = os.networkInterfaces();
      const availableInterfaces = Object.keys(networkInterfaces);
      if (!availableInterfaces.includes(this.mdnsInterface)) {
        this.log.error(`Invalid mdnsInterface: ${this.mdnsInterface}. Available interfaces are: ${availableInterfaces.join(', ')}. Using all available interfaces.`);
        this.mdnsInterface = undefined;
      } else {
        this.log.info(`Using mdnsInterface '${this.mdnsInterface}' for the Matter server MdnsBroadcaster.`);
      }
    }
    const matterServer = new MatterServer(storageManager, { mdnsInterface: this.mdnsInterface });
    this.log.debug('Created matter server');
    return matterServer;
  }

  /**
   * Creates a Matter Aggregator.
   * @param {StorageContext} context - The storage context.
   * @returns {Aggregator} - The created Matter Aggregator.
   */
  private async createMatterAggregator(context: StorageContext, pluginName: string): Promise<Aggregator> {
    const random = 'AG' + CryptoNode.getRandomData(8).toHex();
    await context.set('aggregatorSerialNumber', await context.get('aggregatorSerialNumber', random));
    await context.set('aggregatorUniqueId', await context.get('aggregatorUniqueId', random));

    this.log.debug(`Creating matter aggregator for plugin ${plg}${pluginName}${db} with uniqueId ${await context.get<string>('aggregatorUniqueId')} serialNumber ${await context.get<string>('aggregatorSerialNumber')}`);
    this.log.debug(`Creating matter aggregator for plugin ${plg}${pluginName}${db} with softwareVersion ${await context.get<number>('softwareVersion', 1)} softwareVersionString ${await context.get<string>('softwareVersionString', '1.0.0')}`);
    this.log.debug(`Creating matter aggregator for plugin ${plg}${pluginName}${db} with hardwareVersion ${await context.get<number>('hardwareVersion', 1)} hardwareVersionString ${await context.get<string>('hardwareVersionString', '1.0.0')}`);

    const matterAggregator = new Aggregator();
    matterAggregator.addClusterServer(
      ClusterServer(
        BasicInformationCluster,
        {
          dataModelRevision: 1,
          location: 'FR',
          vendorId: VendorId(0xfff1),
          vendorName: 'Matterbridge',
          productId: 0x8000,
          productName: 'Matterbridge aggregator',
          productLabel: 'Matterbridge aggregator',
          nodeLabel: 'Matterbridge aggregator',
          serialNumber: await context.get<string>('aggregatorSerialNumber'),
          uniqueId: await context.get<string>('aggregatorUniqueId'),
          softwareVersion: await context.get<number>('softwareVersion', 1),
          softwareVersionString: await context.get<string>('softwareVersionString', '1.0.0'),
          hardwareVersion: await context.get<number>('hardwareVersion', 1),
          hardwareVersionString: await context.get<string>('hardwareVersionString', '1.0.0'),
          reachable: true,
          capabilityMinima: { caseSessionsPerFabric: 3, subscriptionsPerFabric: 3 },
        },
        {},
        {
          startUp: true,
          shutDown: true,
          leave: true,
          reachableChanged: true,
        },
      ),
    );
    return matterAggregator;
  }

  /**
   * Stops the Matter server and associated controllers.
   */
  private async stopMatter() {
    this.log.debug('Stopping matter commissioningServer');
    await this.commissioningServer?.close();
    this.log.debug('Stopping matter commissioningController');
    await this.commissioningController?.close();
    this.log.debug('Stopping matter server');
    await this.matterServer?.close();
    this.log.debug('Matter server closed');
    this.commissioningController = undefined;
    this.commissioningServer = undefined;
    this.matterAggregator = undefined;
    this.matterServer = undefined;
  }

  /**
   * Retrieves the latest version of a package from the npm registry.
   * @param packageName - The name of the package.
   * @returns A Promise that resolves to the latest version of the package.
   */
  private async getLatestVersion(packageName: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(`npm view ${packageName} version`, (error: ExecException | null, stdout: string) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout.trim());
        }
      });
    });
  }

  /**
   * Retrieves the path to the global Node.js modules directory.
   * @returns A promise that resolves to the path of the global Node.js modules directory.
   */
  private async getGlobalNodeModules(): Promise<string> {
    return new Promise((resolve, reject) => {
      exec('npm root -g', (error: ExecException | null, stdout: string) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout.trim());
        }
      });
    });
  }

  /**
   * Logs the node and system information.
   */
  private async logNodeAndSystemInfo() {
    // IP address information
    const networkInterfaces = os.networkInterfaces();
    this.systemInformation.ipv4Address = '';
    this.systemInformation.ipv6Address = '';
    for (const [interfaceName, interfaceDetails] of Object.entries(networkInterfaces)) {
      if (!interfaceDetails) {
        break;
      }
      for (const detail of interfaceDetails) {
        if (detail.family === 'IPv4' && !detail.internal && this.systemInformation.ipv4Address === '') {
          this.systemInformation.interfaceName = interfaceName;
          this.systemInformation.ipv4Address = detail.address;
          this.systemInformation.macAddress = detail.mac;
        } else if (detail.family === 'IPv6' && !detail.internal && this.systemInformation.ipv6Address === '') {
          this.systemInformation.interfaceName = interfaceName;
          this.systemInformation.ipv6Address = detail.address;
          this.systemInformation.macAddress = detail.mac;
        }
      }
      if (this.systemInformation.ipv4Address !== '' /* && this.systemInformation.ipv6Address !== ''*/) {
        this.log.debug(`Using interface: '${this.systemInformation.interfaceName}'`);
        this.log.debug(`- with MAC address: '${this.systemInformation.macAddress}'`);
        this.log.debug(`- with IPv4 address: '${this.systemInformation.ipv4Address}'`);
        this.log.debug(`- with IPv6 address: '${this.systemInformation.ipv6Address}'`);
        break;
      }
    }

    // Node information
    this.systemInformation.nodeVersion = process.versions.node;
    const versionMajor = parseInt(this.systemInformation.nodeVersion.split('.')[0]);
    const versionMinor = parseInt(this.systemInformation.nodeVersion.split('.')[1]);
    const versionPatch = parseInt(this.systemInformation.nodeVersion.split('.')[2]);

    // Host system information
    this.systemInformation.hostname = os.hostname();
    this.systemInformation.user = os.userInfo().username;
    this.systemInformation.osType = os.type(); // "Windows_NT", "Darwin", etc.
    this.systemInformation.osRelease = os.release(); // Kernel version
    this.systemInformation.osPlatform = os.platform(); // "win32", "linux", "darwin", etc.
    this.systemInformation.osArch = os.arch(); // "x64", "arm", etc.
    this.systemInformation.totalMemory = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2) + ' GB'; // Convert to GB
    this.systemInformation.freeMemory = (os.freemem() / 1024 / 1024 / 1024).toFixed(2) + ' GB'; // Convert to GB
    this.systemInformation.systemUptime = (os.uptime() / 60 / 60).toFixed(2) + ' hours'; // Convert to hours

    // Log the system information
    this.log.debug('Host System Information:');
    this.log.debug(`- Hostname: ${this.systemInformation.hostname}`);
    this.log.debug(`- User: ${this.systemInformation.user}`);
    this.log.debug(`- Interface: ${this.systemInformation.interfaceName}`);
    this.log.debug(`- MAC Address: ${this.systemInformation.macAddress}`);
    this.log.debug(`- IPv4 Address: ${this.systemInformation.ipv4Address}`);
    this.log.debug(`- IPv6 Address: ${this.systemInformation.ipv6Address}`);
    this.log.debug(`- Node.js: ${versionMajor}.${versionMinor}.${versionPatch}`);
    this.log.debug(`- OS Type: ${this.systemInformation.osType}`);
    this.log.debug(`- OS Release: ${this.systemInformation.osRelease}`);
    this.log.debug(`- Platform: ${this.systemInformation.osPlatform}`);
    this.log.debug(`- Architecture: ${this.systemInformation.osArch}`);
    this.log.debug(`- Total Memory: ${this.systemInformation.totalMemory}`);
    this.log.debug(`- Free Memory: ${this.systemInformation.freeMemory}`);
    this.log.debug(`- System Uptime: ${this.systemInformation.systemUptime}`);

    // Home directory
    this.homeDirectory = os.homedir();
    this.matterbridgeInformation.homeDirectory = this.homeDirectory;
    this.log.debug(`Home Directory: ${this.homeDirectory}`);

    // Package root directory
    const currentFileDirectory = path.dirname(fileURLToPath(import.meta.url));
    this.rootDirectory = path.resolve(currentFileDirectory, '../');
    this.matterbridgeInformation.rootDirectory = this.rootDirectory;
    this.log.debug(`Root Directory: ${this.rootDirectory}`);

    // Global node_modules directory
    if (this.nodeContext) this.globalModulesDirectory = await this.nodeContext.get<string>('globalModulesDirectory', '');
    // First run of Matterbridge so the node storage is empty
    if (this.globalModulesDirectory === '') {
      try {
        this.globalModulesDirectory = await this.getGlobalNodeModules();
        this.matterbridgeInformation.globalModulesDirectory = this.globalModulesDirectory;
        this.log.debug(`Global node_modules Directory: ${this.globalModulesDirectory}`);
        await this.nodeContext?.set<string>('globalModulesDirectory', this.globalModulesDirectory);
      } catch (error) {
        this.log.error(`Error getting global node_modules directory: ${error}`);
      }
    } else {
      this.getGlobalNodeModules()
        .then(async (globalModulesDirectory) => {
          this.globalModulesDirectory = globalModulesDirectory;
          this.matterbridgeInformation.globalModulesDirectory = this.globalModulesDirectory;
          this.log.debug(`Global node_modules Directory: ${this.globalModulesDirectory}`);
          await this.nodeContext?.set<string>('globalModulesDirectory', this.globalModulesDirectory);
        })
        .catch((error) => {
          this.log.error(`Error getting global node_modules directory: ${error}`);
        });
    }

    // Create the data directory .matterbridge in the home directory
    this.matterbridgeDirectory = path.join(this.homeDirectory, '.matterbridge');
    this.matterbridgeInformation.matterbridgeDirectory = this.matterbridgeDirectory;
    try {
      await fs.access(this.matterbridgeDirectory);
    } catch (err) {
      if (err instanceof Error) {
        const nodeErr = err as NodeJS.ErrnoException;
        if (nodeErr.code === 'ENOENT') {
          try {
            await fs.mkdir(this.matterbridgeDirectory, { recursive: true });
            this.log.info(`Created Matterbridge Directory: ${this.matterbridgeDirectory}`);
          } catch (err) {
            this.log.error(`Error creating directory: ${err}`);
          }
        } else {
          this.log.error(`Error accessing directory: ${err}`);
        }
      }
    }
    this.log.debug(`Matterbridge Directory: ${this.matterbridgeDirectory}`);

    // Create the plugin directory Matterbridge in the home directory
    this.matterbridgePluginDirectory = path.join(this.homeDirectory, 'Matterbridge');
    this.matterbridgeInformation.matterbridgePluginDirectory = this.matterbridgePluginDirectory;
    try {
      await fs.access(this.matterbridgePluginDirectory);
    } catch (err) {
      if (err instanceof Error) {
        const nodeErr = err as NodeJS.ErrnoException;
        if (nodeErr.code === 'ENOENT') {
          try {
            await fs.mkdir(this.matterbridgePluginDirectory, { recursive: true });
            this.log.info(`Created Matterbridge Plugin Directory: ${this.matterbridgePluginDirectory}`);
          } catch (err) {
            this.log.error(`Error creating directory: ${err}`);
          }
        } else {
          this.log.error(`Error accessing directory: ${err}`);
        }
      }
    }
    this.log.debug(`Matterbridge Plugin Directory: ${this.matterbridgePluginDirectory}`);

    // Matterbridge version
    const packageJson = JSON.parse(await fs.readFile(path.join(this.rootDirectory, 'package.json'), 'utf-8'));
    this.matterbridgeVersion = packageJson.version;
    this.matterbridgeInformation.matterbridgeVersion = this.matterbridgeVersion;
    this.log.debug(`Matterbridge Version: ${this.matterbridgeVersion}`);

    // Matterbridge latest version
    if (this.nodeContext) this.matterbridgeLatestVersion = await this.nodeContext.get<string>('matterbridgeLatestVersion', '');
    this.log.debug(`Matterbridge Latest Version: ${this.matterbridgeLatestVersion}`);
    this.getMatterbridgeLatestVersion();

    // Current working directory
    const currentDir = process.cwd();
    this.log.debug(`Current Working Directory: ${currentDir}`);

    // Command line arguments (excluding 'node' and the script name)
    const cmdArgs = process.argv.slice(2).join(' ');
    this.log.debug(`Command Line Arguments: ${cmdArgs}`);
  }

  /**
   * Retrieves the latest version of Matterbridge and performs necessary actions based on the version comparison.
   * @private
   * @returns {Promise<void>} A promise that resolves when the latest version is retrieved and actions are performed.
   */
  private async getMatterbridgeLatestVersion(): Promise<void> {
    this.getLatestVersion('matterbridge')
      .then(async (matterbridgeLatestVersion) => {
        this.matterbridgeLatestVersion = matterbridgeLatestVersion;
        this.matterbridgeInformation.matterbridgeLatestVersion = this.matterbridgeLatestVersion;
        this.log.debug(`Matterbridge Latest Version: ${this.matterbridgeLatestVersion}`);
        await this.nodeContext?.set<string>('matterbridgeLatestVersion', this.matterbridgeLatestVersion);
        if (this.matterbridgeVersion !== this.matterbridgeLatestVersion) {
          this.log.warn(`Matterbridge is out of date. Current version: ${this.matterbridgeVersion}, Latest version: ${this.matterbridgeLatestVersion}`);
        }
      })
      .catch((error: Error) => {
        this.log.error(`Error getting Matterbridge latest version: ${error.message}`);
        // error.stack && this.log.debug(error.stack);
      });
  }

  /**
   * Retrieves the latest version of a plugin and updates the plugin's latestVersion property.
   * If the plugin's version is different from the latest version, logs a warning message.
   * If the plugin's version is the same as the latest version, logs an info message.
   * If there is an error retrieving the latest version, logs an error message.
   *
   * @private
   * @param {RegisteredPlugin} plugin - The plugin for which to retrieve the latest version.
   * @returns {Promise<void>} A promise that resolves when the latest version is retrieved and actions are performed.
   */
  private async getPluginLatestVersion(plugin: RegisteredPlugin): Promise<void> {
    this.getLatestVersion(plugin.name)
      .then(async (latestVersion) => {
        plugin.latestVersion = latestVersion;
        await this.nodeContext?.set<RegisteredPlugin[]>('plugins', await this.getBaseRegisteredPlugins());
        if (plugin.version !== latestVersion) this.log.warn(`The plugin ${plg}${plugin.name}${wr} is out of date. Current version: ${plugin.version}, Latest version: ${latestVersion}`);
        else this.log.info(`The plugin ${plg}${plugin.name}${nf} is up to date. Current version: ${plugin.version}, Latest version: ${latestVersion}`);
      })
      .catch((error: Error) => {
        this.log.error(`Error getting ${plugin.name} latest version: ${error.message}`);
        // error.stack && this.log.debug(error.stack);
      });
  }

  /**
   * Retrieves an array of base registered plugins.
   *
   * @returns {BaseRegisteredPlugin[]} An array of base registered plugins.
   */
  private async getBaseRegisteredPlugins(includeConfigSchema = false): Promise<BaseRegisteredPlugin[]> {
    const baseRegisteredPlugins: BaseRegisteredPlugin[] = [];
    for (const plugin of this.registeredPlugins) {
      baseRegisteredPlugins.push({
        path: plugin.path,
        type: plugin.type,
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        author: plugin.author,
        latestVersion: plugin.latestVersion,
        locked: plugin.locked,
        error: plugin.error,
        enabled: plugin.enabled,
        loaded: plugin.loaded,
        started: plugin.started,
        configured: plugin.configured,
        paired: plugin.paired,
        connected: plugin.connected,
        fabricInformations: plugin.fabricInformations,
        sessionInformations: plugin.sessionInformations,
        registeredDevices: plugin.registeredDevices,
        addedDevices: plugin.addedDevices,
        qrPairingCode: plugin.qrPairingCode,
        manualPairingCode: plugin.manualPairingCode,
        configJson: includeConfigSchema ? plugin.configJson : {},
        schemaJson: includeConfigSchema ? plugin.schemaJson : {},
      });
    }
    return baseRegisteredPlugins;
  }

  /**
   * Spawns a child process with the given command and arguments.
   * @param command - The command to execute.
   * @param args - The arguments to pass to the command (default: []).
   * @returns A promise that resolves when the child process exits successfully, or rejects if there is an error.
   */
  private async spawnCommand(command: string, args: string[] = []): Promise<void> {
    /*
    npm > npm.cmd on windows
    cmd.exe ['dir'] on windows
    await this.spawnCommand('npm', ['install', '-g', 'matterbridge']);
    process.on('unhandledRejection', (reason, promise) => {
      this.log.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });
    */

    if (process.platform === 'win32' && command === 'npm') {
      // Must be spawn('cmd.exe', ['/c', 'npm -g install <package>']);
      const argstring = 'npm ' + args.join(' ');
      args.splice(0, args.length, '/c', argstring);
      command = 'cmd.exe';
    }
    if (process.platform === 'linux' && command === 'npm' && !hasParameter('docker')) {
      args.unshift(command);
      command = 'sudo';
    }
    this.log.debug(`Spawn command ${command} with ${debugStringify(args)}`);
    return new Promise((resolve, reject) => {
      const childProcess = spawn(command, args, {
        stdio: ['inherit', 'pipe', 'pipe'],
      });

      childProcess.on('error', (err) => {
        this.log.error(`Failed to start child process: ${err.message}`);
        reject(err); // Reject the promise on error
      });

      childProcess.on('close', (code) => {
        if (code === 0) {
          this.log.debug(`Child process stdio streams have closed with code ${code}`);
          resolve();
        } else {
          this.log.error(`Child process stdio streams have closed with code ${code}`);
          reject(new Error(`Child process stdio streams have closed with code  ${code}`));
        }
      });

      childProcess.on('exit', (code, signal) => {
        if (code === 0) {
          this.log.debug(`Child process exited with code ${code} and signal ${signal}`);
          resolve();
        } else {
          this.log.error(`Child process exited with code ${code} and signal ${signal}`);
          reject(new Error(`Child process exited with code ${code} and signal ${signal}`));
        }
      });

      childProcess.on('disconnect', () => {
        this.log.debug('Child process has been disconnected from the parent');
        resolve();
      });

      if (childProcess.stdout) {
        childProcess.stdout.on('data', (data: Buffer) => {
          const message = data.toString().trim();
          // this.log.info('\n' + message);
          this.wssSendMessage('Matterbridge:spawn', 'spawn', message);
        });
      }

      if (childProcess.stderr) {
        childProcess.stderr.on('data', (data: Buffer) => {
          const message = data.toString().trim();
          // this.log.debug('\n' + message);
          this.wssSendMessage('Matterbridge:spawn', 'spawn', message);
        });
      }
    });
  }

  /**
   * Sends a WebSocket message to all connected clients.
   *
   * @param {string} type - The type of the message: Matterbridge, Plugin, Device, ...
   * @param {string} subType - The subtype of the message: debug info warn error ....
   * @param {string} message - The content of the message.
   */
  private wssSendMessage(type: string, subType: string, message: string) {
    // Remove ANSI escape codes from the message
    // eslint-disable-next-line no-control-regex
    const cleanMessage = message.replace(/\x1B\[[0-9;]*[m|s|u|K]/g, '');
    // Remove leading asterisks from the message
    const finalMessage = cleanMessage.replace(/^\*+/, '');
    // Send the message to all connected clients
    this.webSocketServer?.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type, subType, message: finalMessage }));
      }
    });
  }

  /**
   * Initializes the frontend of Matterbridge.
   *
   * @param port The port number to run the frontend server on. Default is 3000.
   */
  async initializeFrontend(port = 8283): Promise<void> {
    this.log.debug(`Initializing the frontend ${hasParameter('ssl') ? 'https' : 'http'} server on port ${YELLOW}${port}${db}`);

    // Create the express app that serves the frontend
    this.expressApp = express();
    this.expressApp.use(express.static(path.join(this.rootDirectory, 'frontend/build')));

    if (!hasParameter('ssl')) {
      // Create an HTTP server and attach the express app
      this.httpServer = createServer(this.expressApp);

      // Listen on the specified port
      this.httpServer.listen(port, () => {
        if (this.systemInformation.ipv4Address !== '') this.log.info(`The frontend http server is listening on ${UNDERLINE}http://${this.systemInformation.ipv4Address}:${port}${UNDERLINEOFF}${rs}`);
        if (this.systemInformation.ipv6Address !== '') this.log.debug(`The frontend http server is listening on ${UNDERLINE}http://[${this.systemInformation.ipv6Address}]:${port}${UNDERLINEOFF}${rs}`);
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.httpServer.on('error', (error: any) => {
        this.log.error(`Frontend http server error listening on ${port}`);
        switch (error.code) {
          case 'EACCES':
            this.log.error(`Port ${port} requires elevated privileges`);
            break;
          case 'EADDRINUSE':
            this.log.error(`Port ${port} is already in use`);
            break;
        }
        process.exit(1);
      });
    } else {
      // Load the SSL certificate, the private key and optionally the CA certificate
      let cert: string | undefined;
      try {
        cert = await fs.readFile(path.join(this.matterbridgeDirectory, 'certs/cert.pem'), 'utf8');
        this.log.info(`Loaded certificate file ${path.join(this.matterbridgeDirectory, 'certs/cert.pem')}`);
      } catch (error) {
        this.log.error(`Error reading certificate file: ${error}`);
        process.exit(1);
      }
      let key: string | undefined;
      try {
        key = await fs.readFile(path.join(this.matterbridgeDirectory, 'certs/key.pem'), 'utf8');
        this.log.info(`Loaded key file ${path.join(this.matterbridgeDirectory, 'certs/key.pem')}`);
      } catch (error) {
        this.log.error(`Error reading key file: ${error}`);
        process.exit(1);
      }
      let ca: string | undefined;
      try {
        ca = await fs.readFile(path.join(this.matterbridgeDirectory, 'certs/ca.pem'), 'utf8');
        this.log.info(`Loaded CA certificate file ${path.join(this.matterbridgeDirectory, 'certs/ca.pem')}`);
      } catch (error) {
        this.log.info(`CA certificate file ${path.join(this.matterbridgeDirectory, 'certs/ca.pem')} not loaded: ${error}`);
      }
      const serverOptions: https.ServerOptions = { cert, key, ca };

      // Create an HTTPS server with the SSL certificate and private key (ca is optional) and attach the express app
      this.httpsServer = https.createServer(serverOptions, this.expressApp);

      // Listen on the specified port
      this.httpsServer.listen(port, () => {
        if (this.systemInformation.ipv4Address !== '') this.log.info(`The frontend https server is listening on ${UNDERLINE}https://${this.systemInformation.ipv4Address}:${port}${UNDERLINEOFF}${rs}`);
        if (this.systemInformation.ipv6Address !== '') this.log.debug(`The frontend https server is listening on ${UNDERLINE}https://[${this.systemInformation.ipv6Address}]:${port}${UNDERLINEOFF}${rs}`);
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.httpsServer.on('error', (error: any) => {
        this.log.error(`Frontend https server error listening on ${port}`);
        switch (error.code) {
          case 'EACCES':
            this.log.error(`Port ${port} requires elevated privileges`);
            break;
          case 'EADDRINUSE':
            this.log.error(`Port ${port} is already in use`);
            break;
        }
        process.exit(1);
      });
    }

    // Createe a WebSocket server and attach it to the http server
    const wssPort = port;
    const wssHost = hasParameter('ssl') ? `wss://${this.systemInformation.ipv4Address}:${wssPort}` : `ws://${this.systemInformation.ipv4Address}:${wssPort}`;
    this.webSocketServer = new WebSocketServer(hasParameter('ssl') ? { server: this.httpsServer } : { server: this.httpServer });

    this.webSocketServer.on('connection', (ws: WebSocket, request: http.IncomingMessage) => {
      const clientIp = request.socket.remoteAddress;
      this.log.info(`WebSocketServer client ${clientIp} connected`);
      this.log.setGlobalCallback(this.wssSendMessage.bind(this));
      this.log.debug('WebSocketServer logger callback added');
      this.wssSendMessage('Matterbridge', 'info', `WebSocketServer client ${clientIp} connected to Matterbridge`);

      ws.on('message', (message) => {
        this.log.debug(`WebSocket client message: ${message}`);
      });

      ws.on('close', () => {
        this.log.info('WebSocket client disconnected');
        if (this.webSocketServer?.clients.size === 0) {
          this.log.setGlobalCallback(undefined);
          this.log.debug('All WebSocket clients disconnected. WebSocketServer logger callback removed');
        }
      });

      ws.on('error', (error: Error) => {
        this.log.error(`WebSocket client error: ${error}`);
      });
    });

    this.webSocketServer.on('close', () => {
      this.log.debug(`WebSocketServer closed`);
    });

    this.webSocketServer.on('listening', () => {
      this.log.info(`The WebSocketServer is listening on ${UNDERLINE}${wssHost}${UNDERLINEOFF}${rs}`);
    });

    this.webSocketServer.on('error', (ws: WebSocket, error: Error) => {
      this.log.error(`WebSocketServer error: ${error}`);
    });

    // Endpoint to validate login code
    this.expressApp.post('/api/login', express.json(), async (req, res) => {
      const { password } = req.body;
      this.log.debug('The frontend sent /api/login', password);
      if (!this.nodeContext) {
        this.log.error('/api/login nodeContext not found');
        res.json({ valid: false });
        return;
      }
      try {
        const storedPassword = await this.nodeContext.get('password', '');
        if (storedPassword === '' || password === storedPassword) {
          this.log.debug('/api/login password valid');
          res.json({ valid: true });
        } else {
          this.log.warn('/api/login error wrong password');
          res.json({ valid: false });
        }
      } catch (error) {
        this.log.error('/api/login error getting password');
        res.json({ valid: false });
      }
    });

    // Endpoint to provide settings
    this.expressApp.get('/api/settings', express.json(), async (req, res) => {
      this.log.debug('The frontend sent /api/settings');
      if (!this.matterbridgeContext) {
        this.log.error('/api/settings matterbridgeContext not found');
        res.json({});
        return;
      }
      let qrPairingCode = '';
      let manualPairingCode = '';
      try {
        qrPairingCode = await this.matterbridgeContext.get('qrPairingCode');
        manualPairingCode = await this.matterbridgeContext.get('manualPairingCode');
      } catch (error) {
        if (this.bridgeMode === 'bridge') this.log.warn('pairingCodes for /api/settings not found');
      }
      this.matterbridgeInformation.bridgeMode = this.bridgeMode;
      this.matterbridgeInformation.restartMode = this.restartMode;
      this.matterbridgeInformation.debugEnabled = this.debugEnabled;
      this.matterbridgeInformation.matterLoggerLevel = Logger.defaultLogLevel;
      this.matterbridgeInformation.matterbridgePaired = this.matterbridgePaired;
      this.matterbridgeInformation.matterbridgeConnected = this.matterbridgeConnected;
      this.matterbridgeInformation.matterbridgeFabricInformations = this.matterbridgeFabricInformations;
      this.matterbridgeInformation.matterbridgeSessionInformations = this.matterbridgeSessionInformations;
      const response = { wssHost, qrPairingCode, manualPairingCode, systemInformation: this.systemInformation, matterbridgeInformation: this.matterbridgeInformation };
      // this.log.debug('Response:', debugStringify(response));
      res.json(response);
    });

    // Endpoint to provide plugins
    this.expressApp.get('/api/plugins', async (req, res) => {
      this.log.debug('The frontend sent /api/plugins');
      const response = await this.getBaseRegisteredPlugins(true);
      // this.log.debug('Response:', debugStringify(response));
      res.json(response);
    });

    // Endpoint to provide devices
    this.expressApp.get('/api/devices', (req, res) => {
      this.log.debug('The frontend sent /api/devices');
      const data: { pluginName: string; type: string; endpoint: EndpointNumber | undefined; name: string; serial: string; uniqueId: string; cluster: string }[] = [];
      this.registeredDevices.forEach((registeredDevice) => {
        let name = registeredDevice.device.getClusterServer(BasicInformationCluster)?.attributes.nodeLabel?.getLocal();
        if (!name) name = registeredDevice.device.getClusterServer(BridgedDeviceBasicInformationCluster)?.attributes.nodeLabel?.getLocal() ?? 'Unknown';
        let serial = registeredDevice.device.getClusterServer(BasicInformationCluster)?.attributes.serialNumber?.getLocal();
        if (!serial) serial = registeredDevice.device.getClusterServer(BridgedDeviceBasicInformationCluster)?.attributes.serialNumber?.getLocal() ?? 'Unknown';
        let uniqueId = registeredDevice.device.getClusterServer(BasicInformationCluster)?.attributes.uniqueId?.getLocal();
        if (!uniqueId) uniqueId = registeredDevice.device.getClusterServer(BridgedDeviceBasicInformationCluster)?.attributes.uniqueId?.getLocal() ?? 'Unknown';
        const cluster = this.getClusterTextFromDevice(registeredDevice.device);
        data.push({
          pluginName: registeredDevice.plugin,
          type: registeredDevice.device.name + ' (0x' + registeredDevice.device.deviceType.toString(16).padStart(4, '0') + ')',
          endpoint: registeredDevice.device.number,
          name,
          serial,
          uniqueId,
          cluster: cluster,
        });
      });
      // this.log.debug('Response:', debugStringify(data));
      res.json(data);
    });

    // Endpoint to provide the cluster servers of the devices
    this.expressApp.get('/api/devices_clusters/:selectedPluginName/:selectedDeviceEndpoint', (req, res) => {
      const selectedPluginName = req.params.selectedPluginName;
      const selectedDeviceEndpoint: number = parseInt(req.params.selectedDeviceEndpoint, 10);
      this.log.debug(`The frontend sent /api/devices_clusters plugin:${selectedPluginName} endpoint:${selectedDeviceEndpoint}`);
      if (selectedPluginName === 'none') {
        res.json([]);
        return;
      }
      const data: { endpoint: string; clusterName: string; clusterId: string; attributeName: string; attributeId: string; attributeValue: string }[] = [];
      this.registeredDevices.forEach((registeredDevice) => {
        if (registeredDevice.plugin === selectedPluginName && registeredDevice.device.number === selectedDeviceEndpoint) {
          const clusterServers = registeredDevice.device.getAllClusterServers();
          clusterServers.forEach((clusterServer) => {
            Object.entries(clusterServer.attributes).forEach(([key, value]) => {
              if (clusterServer.name === 'EveHistory') return;
              // this.log.debug(`***--clusterServer: ${clusterServer.name}(${clusterServer.id}) attribute:${key}(${value.id}) ${value.isFixed} ${value.isWritable} ${value.isWritable}`);
              let attributeValue;
              try {
                if (typeof value.getLocal() === 'object') attributeValue = stringify(value.getLocal());
                else attributeValue = value.getLocal().toString();
              } catch (error) {
                attributeValue = 'Unavailable';
                this.log.debug(`GetLocal value ${error} in clusterServer: ${clusterServer.name}(${clusterServer.id}) attribute: ${key}(${value.id})`);
                // console.log(error);
              }
              data.push({
                endpoint: registeredDevice.device.number ? registeredDevice.device.number.toString() : '...',
                clusterName: clusterServer.name,
                clusterId: '0x' + clusterServer.id.toString(16).padStart(2, '0'),
                attributeName: key,
                attributeId: '0x' + value.id.toString(16).padStart(2, '0'),
                attributeValue,
              });
            });
          });
          registeredDevice.device.getChildEndpoints().forEach((childEndpoint) => {
            const name = registeredDevice.device.getChildEndpointName(childEndpoint);
            const clusterServers = childEndpoint.getAllClusterServers();
            clusterServers.forEach((clusterServer) => {
              Object.entries(clusterServer.attributes).forEach(([key, value]) => {
                if (clusterServer.name === 'EveHistory') return;
                // this.log.debug(`***--clusterServer: ${clusterServer.name}(${clusterServer.id}) attribute:${key}(${value.id}) ${value.isFixed} ${value.isWritable} ${value.isWritable}`);
                let attributeValue;
                try {
                  if (typeof value.getLocal() === 'object') attributeValue = stringify(value.getLocal());
                  else attributeValue = value.getLocal().toString();
                } catch (error) {
                  attributeValue = 'Unavailable';
                  this.log.debug(`GetLocal error ${error} in clusterServer: ${clusterServer.name}(${clusterServer.id}) attribute: ${key}(${value.id})`);
                  // console.log(error);
                }
                data.push({
                  endpoint: (childEndpoint.number ? childEndpoint.number.toString() : '...') + (name ? ' (' + name + ')' : ''),
                  clusterName: clusterServer.name,
                  clusterId: '0x' + clusterServer.id.toString(16).padStart(2, '0'),
                  attributeName: key,
                  attributeId: '0x' + value.id.toString(16).padStart(2, '0'),
                  attributeValue,
                });
              });
            });
          });
        }
      });
      res.json(data);
    });

    // Endpoint to receive commands
    this.expressApp.post('/api/command/:command/:param', express.json(), async (req, res) => {
      const command = req.params.command;
      let param = req.params.param;
      this.log.debug(`The frontend sent /api/command/${command}/${param}`);

      if (!command) {
        res.status(400).json({ error: 'No command provided' });
        return;
      }

      this.log.debug(`Received frontend command: ${command}:${param}`);

      // Handle the command setpassword from Settings
      if (command === 'setpassword') {
        const password = param.slice(1, -1); // Remove the first and last characters
        this.log.debug('setpassword', param, password);
        await this.nodeContext?.set('password', password);
      }

      // Handle the command setmbloglevel from Settings
      if (command === 'setmbloglevel') {
        this.log.debug('Matterbridge log level:', param);
        if (param === 'Debug') {
          this.log.setLogDebug(true);
          this.debugEnabled = true;
        } else if (param === 'Info') {
          this.log.setLogDebug(false);
          this.debugEnabled = false;
        }
      }

      // Handle the command setmbloglevel from Settings
      if (command === 'setmjloglevel') {
        this.log.debug('Matter.js log level::', param);
        if (param === 'Debug') {
          Logger.defaultLogLevel = Level.DEBUG;
        } else if (param === 'Info') {
          Logger.defaultLogLevel = Level.INFO;
        } else if (param === 'Notice') {
          Logger.defaultLogLevel = Level.NOTICE;
        } else if (param === 'Warn') {
          Logger.defaultLogLevel = Level.WARN;
        } else if (param === 'Error') {
          Logger.defaultLogLevel = Level.ERROR;
        } else if (param === 'Fatal') {
          Logger.defaultLogLevel = Level.FATAL;
        }
      }

      // Handle the command unregister from Settings
      if (command === 'unregister') {
        await this.unregisterAndShutdownProcess();
      }
      // Handle the command reset from Settings
      if (command === 'reset') {
        this.shutdownProcessAndReset(); // No await do it asyncronously
      }
      // Handle the command factoryreset from Settings
      if (command === 'factoryreset') {
        this.shutdownProcessAndFactoryReset(); // No await do it asyncronously
      }
      // Handle the command shutdown from Header
      if (command === 'shutdown') {
        this.shutdownProcess(); // No await do it asyncronously
      }
      // Handle the command restart from Header
      if (command === 'restart') {
        this.restartProcess(); // No await do it asyncronously
      }
      // Handle the command update from Header
      if (command === 'update') {
        this.log.info('Updating matterbridge...');
        try {
          await this.spawnCommand('npm', ['install', '-g', 'matterbridge', '--loglevel=verbose']);
          this.log.info('Matterbridge has been updated. Full restart required.');
        } catch (error) {
          this.log.error('Error updating matterbridge');
          res.json({ message: 'Command received' });
          return;
        }
        this.updateProcess();
      }
      // Handle the command saveconfig from Home
      if (command === 'saveconfig') {
        param = param.replace(/\*/g, '\\');
        this.log.info(`Saving config for plugin ${plg}${param}${nf}...`);
        // console.log('Req.body:', JSON.stringify(req.body, null, 2));
        const plugins = await this.nodeContext?.get<RegisteredPlugin[]>('plugins');
        if (!plugins) return;
        const plugin = plugins.find((plugin) => plugin.name === param);
        if (!plugin) return;
        this.savePluginConfigFromJson(plugin, req.body);
      }

      // Handle the command installplugin from Home
      if (command === 'installplugin') {
        param = param.replace(/\*/g, '\\');
        this.log.info(`Installing plugin ${plg}${param}${nf}...`);
        try {
          await this.spawnCommand('npm', ['install', '-g', param, '--loglevel=verbose']);
          this.log.info(`Plugin ${plg}${param}${nf} installed. Full restart required.`);
        } catch (error) {
          this.log.error(`Error installing plugin ${plg}${param}${er}`);
          res.json({ message: 'Command received' });
          return;
        }
      }
      // Handle the command addplugin from Home
      if (command === 'addplugin' || command === 'installplugin') {
        param = param.replace(/\*/g, '\\');
        if (this.registeredPlugins.find((plugin) => plugin.name === param)) {
          this.log.warn(`Plugin ${plg}${param}${wr} already added to matterbridge`);
          res.json({ message: 'Command received' });
          return;
        }
        const packageJsonPath = await this.resolvePluginName(param);
        if (!packageJsonPath) {
          this.log.error(`Error resolving plugin ${plg}${param}${er}`);
          res.json({ message: 'Command received' });
          return;
        }
        this.log.debug(`Loading plugin from ${plg}${packageJsonPath}${db}`);
        try {
          // Load the package.json of the plugin
          const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
          const plugin = { path: packageJsonPath, type: '', name: packageJson.name, version: packageJson.version, description: packageJson.description, author: packageJson.author, enabled: true };
          if (await this.loadPlugin(plugin)) {
            this.registeredPlugins.push(plugin);
            await this.nodeContext?.set<RegisteredPlugin[]>('plugins', await this.getBaseRegisteredPlugins());
            this.log.info(`Plugin ${plg}${packageJsonPath}${nf} type ${plugin.type} added to matterbridge. Restart required.`);
            this.startPlugin(plugin, 'The plugin has been added to Matterbridge', true);
          } else {
            this.log.error(`Error adding plugin ${plg}${packageJsonPath}${er}`);
          }
        } catch (error) {
          this.log.error(`Error adding plugin ${plg}${packageJsonPath}${er}`);
          res.json({ message: 'Command received' });
          return;
        }
      }
      // Handle the command removeplugin from Home
      if (command === 'removeplugin') {
        const index = this.registeredPlugins.findIndex((registeredPlugin) => registeredPlugin.name === param);
        if (index !== -1) {
          if (this.registeredPlugins[index].platform) {
            await this.registeredPlugins[index].platform?.onShutdown('The plugin has been removed.');
          }
          // Remove all devices from the plugin
          await this.removeAllBridgedDevices(this.registeredPlugins[index].name);
          // Remove the plugin from the registered plugins
          this.registeredPlugins.splice(index, 1);
          await this.nodeContext?.set<RegisteredPlugin[]>('plugins', await this.getBaseRegisteredPlugins());
          this.log.info(`Plugin ${plg}${param}${nf} removed from matterbridge`);
        } else {
          this.log.warn(`Plugin ${plg}${param}${wr} not registered in matterbridge`);
        }
      }
      // Handle the command enableplugin from Home
      if (command === 'enableplugin') {
        const plugins = await this.nodeContext?.get<RegisteredPlugin[]>('plugins');
        if (!plugins) return;
        const plugin = plugins.find((plugin) => plugin.name === param);
        if (plugin) {
          plugin.enabled = true;
          plugin.locked = undefined;
          plugin.error = undefined;
          plugin.loaded = undefined;
          plugin.started = undefined;
          plugin.configured = undefined;
          plugin.connected = undefined;
          plugin.platform = undefined;
          plugin.registeredDevices = undefined;
          plugin.addedDevices = undefined;
          await this.nodeContext?.set<RegisteredPlugin[]>('plugins', plugins);
          this.log.info(`Enabled plugin ${plg}${param}${nf}`);
        }
        if (this.bridgeMode === 'bridge') {
          const pluginToEnable = this.findPlugin(param);
          if (pluginToEnable) {
            pluginToEnable.enabled = true;
            pluginToEnable.platform = await this.loadPlugin(pluginToEnable);
            if (pluginToEnable.platform) {
              await this.startPlugin(pluginToEnable, 'The plugin has been enabled', true);
            } else {
              pluginToEnable.enabled = false;
              pluginToEnable.error = true;
              this.log.error(`Error enabling plugin ${plg}${param}${er}`);
            }
          }
        }
      }
      // Handle the command disableplugin from Home
      if (command === 'disableplugin') {
        const pluginToDisable = this.findPlugin(param);
        if (pluginToDisable) {
          if (pluginToDisable.platform) {
            await pluginToDisable.platform.onShutdown('The plugin has been disabled.');
          }
          // Remove all devices from the plugin
          this.log.info(`Unregistering devices for plugin ${plg}${pluginToDisable.name}${nf}...`);
          await this.removeAllBridgedDevices(pluginToDisable.name);
          pluginToDisable.enabled = false;
          pluginToDisable.locked = undefined;
          pluginToDisable.error = undefined;
          pluginToDisable.loaded = undefined;
          pluginToDisable.started = undefined;
          pluginToDisable.configured = undefined;
          pluginToDisable.connected = undefined;
          pluginToDisable.platform = undefined;
          pluginToDisable.registeredDevices = undefined;
          pluginToDisable.addedDevices = undefined;
          // Save the plugins state in node storage
          const plugins = await this.nodeContext?.get<RegisteredPlugin[]>('plugins');
          if (!plugins) return;
          const plugin = plugins.find((plugin) => plugin.name === param);
          if (plugin) {
            plugin.enabled = false;
            plugin.locked = undefined;
            plugin.error = undefined;
            plugin.loaded = undefined;
            plugin.started = undefined;
            plugin.configured = undefined;
            plugin.connected = undefined;
            plugin.platform = undefined;
            plugin.registeredDevices = undefined;
            plugin.addedDevices = undefined;
            await this.nodeContext?.set<RegisteredPlugin[]>('plugins', plugins);
            this.log.info(`Disabled plugin ${plg}${param}${nf}`);
          }
        }
      }
      res.json({ message: 'Command received' });
    });

    // Fallback for routing (must be the last route)
    this.expressApp.get('*', (req, res) => {
      this.log.debug('The frontend sent:', req.url);
      this.log.debug('Response send file:', path.join(this.rootDirectory, 'frontend/build/index.html'));
      res.sendFile(path.join(this.rootDirectory, 'frontend/build/index.html'));
    });

    this.log.debug(`Frontend initialized on port ${YELLOW}${port}${db} static ${UNDERLINE}${path.join(this.rootDirectory, 'frontend/build')}${UNDERLINEOFF}${rs}`);
  }

  /**
   * Retrieves the cluster text from a given device.
   * @param device - The MatterbridgeDevice object.
   * @returns The attributes of the cluster servers in the device.
   */
  private getClusterTextFromDevice(device: MatterbridgeDevice) {
    const stringifyFixedLabel = (endpoint: Endpoint) => {
      const labelList = endpoint.getClusterServer(FixedLabelCluster)?.getLabelListAttribute();
      if (!labelList) return;
      const composed = labelList.find((entry) => entry.label === 'composed');
      if (composed) return 'Composed: ' + composed.value;
      else return ''; // 'FixedLabel: ' + labelList.map((entry) => entry.label + ': ' + entry.value).join(' ');
    };

    let attributes = '';
    // this.log.debug(`getClusterTextFromDevice: ${device.name}`);
    const clusterServers = device.getAllClusterServers();
    clusterServers.forEach((clusterServer) => {
      // this.log.debug(`***--clusterServer: ${clusterServer.id} (${clusterServer.name})`);
      if (clusterServer.name === 'OnOff') attributes += `OnOff: ${clusterServer.getOnOffAttribute()} `;
      if (clusterServer.name === 'Switch') attributes += `Position: ${clusterServer.getCurrentPositionAttribute()} `;
      if (clusterServer.name === 'WindowCovering') attributes += `Cover position: ${clusterServer.attributes.currentPositionLiftPercent100ths.getLocal() / 100}% `;
      if (clusterServer.name === 'DoorLock') attributes += `State: ${clusterServer.attributes.lockState.getLocal() === 1 ? 'Locked' : 'Not locked'} `;
      if (clusterServer.name === 'Thermostat') attributes += `Temperature: ${clusterServer.attributes.localTemperature.getLocal() / 100}°C `;
      if (clusterServer.name === 'LevelControl') attributes += `Level: ${clusterServer.getCurrentLevelAttribute()}% `;
      if (clusterServer.name === 'ColorControl') attributes += `Hue: ${Math.round(clusterServer.getCurrentHueAttribute())} Saturation: ${Math.round(clusterServer.getCurrentSaturationAttribute())}% `;
      if (clusterServer.name === 'BooleanState') attributes += `Contact: ${clusterServer.getStateValueAttribute()} `;
      if (clusterServer.name === 'OccupancySensing') attributes += `Occupancy: ${clusterServer.getOccupancyAttribute().occupied} `;
      if (clusterServer.name === 'IlluminanceMeasurement') attributes += `Illuminance: ${clusterServer.getMeasuredValueAttribute()} `;
      if (clusterServer.name === 'AirQuality') attributes += `Air quality: ${clusterServer.getAirQualityAttribute()} `;
      if (clusterServer.name === 'TvocMeasurement') attributes += `Voc: ${clusterServer.getMeasuredValueAttribute()} `;
      if (clusterServer.name === 'TemperatureMeasurement') attributes += `Temperature: ${clusterServer.getMeasuredValueAttribute() / 100}°C `;
      if (clusterServer.name === 'RelativeHumidityMeasurement') attributes += `Humidity: ${clusterServer.getMeasuredValueAttribute() / 100}% `;
      if (clusterServer.name === 'PressureMeasurement') attributes += `Pressure: ${clusterServer.getMeasuredValueAttribute()} `;
      if (clusterServer.name === 'FlowMeasurement') attributes += `Flow: ${clusterServer.getMeasuredValueAttribute()} `;
      if (clusterServer.name === 'FixedLabel') attributes += `${stringifyFixedLabel(device)} `;
    });
    return attributes;
  }
}
