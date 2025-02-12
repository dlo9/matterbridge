/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-console */
// Home.js
import React, { useEffect, useState, useRef } from 'react';
import { StatusIndicator } from './StatusIndicator';
import { sendCommandToMatterbridge, theme } from './Header';
import WebSocketComponent from './WebSocketComponent';

// @mui
import { Dialog, DialogTitle, DialogContent, TextField, Alert, Snackbar, Tooltip, IconButton, Button, createTheme, ThemeProvider, Select, MenuItem, Menu } from '@mui/material';
import { DeleteForever, Download, Remove, Add, Unpublished, PublishedWithChanges, Settings, Favorite, Help, Announcement, QrCode2, MoreVert } from '@mui/icons-material';

// @rjsf
import Form from '@rjsf/mui';
import validator from '@rjsf/validator-ajv8';

import QRCode from 'qrcode.react';

// npm install @mui/material @emotion/react @emotion/styled
// npm install @mui/icons-material @mui/material @emotion/styled @emotion/react
// npm install @rjsf/core @rjsf/utils @rjsf/validator-ajv8 @rjsf/mui

function Home() {
  const [wssHost, setWssHost] = useState(null);
  const [qrCode, setQrCode] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [systemInfo, setSystemInfo] = useState({});
  const [matterbridgeInfo, setMatterbridgeInfo] = useState({});
  const [plugins, setPlugins] = useState([]);
  const [selectedRow, setSelectedRow] = useState(-1); // -1 no selection, 0 or greater for selected row
  const [selectedPluginName, setSelectedPluginName] = useState('none'); // -1 no selection, 0 or greater for selected row
  const [selectedPluginConfig, setSelectedPluginConfig] = useState({}); 
  const [selectedPluginSchema, setSelectedPluginSchema] = useState({}); 
  const [openSnack, setOpenSnack] = useState(false);
  const [openConfig, setOpenConfig] = useState(false);
  const [logDebugLevel, setLogDebugLevel] = useState(localStorage.getItem('logFilterLevel')??'debug');
  const [logSearchCriteria, setLogSearchCriteria] = useState(localStorage.getItem('logFilterSearch')??'*');

  const refAddRemove = useRef(null);
  const refRegisteredPlugins = useRef(null);

  const handleSnackOpen = () => {
    console.log('handleSnackOpen');
    setOpenSnack(true);
  };

  const handleSnackClose = (event, reason) => {
    console.log('handleSnackClose:', reason);
    if (reason === 'clickaway') return;
    setOpenSnack(false);
  };

  const handleOpenConfig = () => {
    setOpenConfig(true);
  };

  const handleCloseConfig = () => {
    setOpenConfig(false);
  };


  const columns = React.useMemo( () => [
      { Header: 'Name', accessor: 'name' },
      { Header: 'Description', accessor: 'description' },
      { Header: 'Version', accessor: 'version' },
      { Header: 'Author', accessor: 'author' },
      { Header: 'Type', accessor: 'type' },
      { Header: 'Devices', accessor: 'devices'},
      { Header: 'Tools', accessor: 'qrcode' },
      { Header: 'Status', accessor: 'status'},
    ],
    []
  );

  useEffect(() => {
    // Fetch settings from the backend
    const fetchSettings = () => {

      fetch('/api/settings')
        .then(response => response.json())
        .then(data => { 
          console.log('From home /api/settings:', data); 
          setWssHost(data.wssHost); 
          if(data.matterbridgeInformation.bridgeMode==='bridge') {
            setQrCode(data.qrPairingCode); 
            setPairingCode(data.manualPairingCode);
          }
          setSystemInfo(data.systemInformation);
          setMatterbridgeInfo(data.matterbridgeInformation);
          localStorage.setItem('wssHost', data.wssHost);
          localStorage.setItem('manualPairingCode', data.manualPairingCode); 
          localStorage.setItem('qrPairingCode', data.qrPairingCode); 
          localStorage.setItem('systemInformation', data.systemInformation); 
          localStorage.setItem('matterbridgeInformation', data.matterbridgeInformation); 
        })
        .catch(error => console.error('Error fetching settings:', error));

      fetch('/api/plugins')
        .then(response => response.json())
        .then(data => { 
          console.log('From home /api/plugins:', data)
          setPlugins(data); 
        })
        .catch(error => console.error('Error fetching plugins:', error));
    };  

    // Call fetchSettings immediately and then every 10 minutes
    fetchSettings();
    const intervalId = setInterval(fetchSettings, 1 * 60 * 1000);
  
    // Clear the interval when the component is unmounted
    return () => clearInterval(intervalId);

  }, []); // The empty array causes this effect to run only once

  const handleSelectQRCode = (row) => {
    if (selectedRow === row) {
      setSelectedRow(-1);
      setSelectedPluginName('none');
      // setQrCode(localStorage.getItem('qrPairingCode'));
      // setPairingCode(localStorage.getItem('manualPairingCode'));
      setQrCode('');
      setPairingCode('');
    } else {
      setSelectedRow(row);
      setSelectedPluginName(plugins[row].name);
      setQrCode(plugins[row].qrPairingCode);
      setPairingCode(plugins[row].manualPairingCode);
    }
    // console.log('Selected row:', row, 'plugin:', plugins[row].name, 'qrcode:', plugins[row].qrPairingCode);
  };

  const handleEnableDisable = (row) => {
    console.log('Selected row:', row, 'plugin:', plugins[row].name, 'enabled:', plugins[row].enabled);
    if(plugins[row].enabled===true) {
      plugins[row].enabled=false;
      sendCommandToMatterbridge('disableplugin', plugins[row].name);
    }
    else {
      plugins[row].enabled=true;
      sendCommandToMatterbridge('enableplugin', plugins[row].name);
    }
    console.log('Updating page');
    // setPlugins(prevPlugins => [...prevPlugins]);
    handleSnackOpen({ vertical: 'bottom', horizontal: 'right' });
    setTimeout(() => {
      // window.location.reload();
    }, 5000);
  };

  const handleUpdate = (row) => {
    console.log('handleUpdate row:', row, 'plugin:', plugins[row].name);
    sendCommandToMatterbridge('installplugin', plugins[row].name);
    handleSnackOpen({ vertical: 'bottom', horizontal: 'right' });
    setTimeout(() => {
      // window.location.reload();
    }, 5000);
  };

  const handleRemovePlugin = (row) => {
    console.log('handleRemovePluginClick row:', row, 'plugin:', plugins[row].name);
    sendCommandToMatterbridge('removeplugin', plugins[row].name);
    handleSnackOpen({ vertical: 'bottom', horizontal: 'right' });
    setTimeout(() => {
      // window.location.reload();
    }, 5000);
  };

  const handleConfigPlugin = (row) => {
    console.log('handleConfigPlugin row:', row, 'plugin:', plugins[row].name);
    setSelectedPluginConfig(plugins[row].configJson);
    setSelectedPluginSchema(plugins[row].schemaJson);
    handleOpenConfig();
  };

  const handleSponsorPlugin = (row) => {
    console.log('handleSponsorPlugin row:', row, 'plugin:', plugins[row].name);
    window.open('https://www.buymeacoffee.com/luligugithub', '_blank');
  };

  const handleHelpPlugin = (row) => {
    console.log('handleHelpPlugin row:', row, 'plugin:', plugins[row].name);
    window.open(`https://github.com/Luligu/${plugins[row].name}/blob/main/README.md`, '_blank');
  };

  const handleChangelogPlugin = (row) => {
    console.log('handleChangelogPlugin row:', row, 'plugin:', plugins[row].name);
    window.open(`https://github.com/Luligu/${plugins[row].name}/blob/main/CHANGELOG.md`, '_blank');
  };

  /*
        {matterbridgeInfo && <MatterbridgeInfoTable matterbridgeInfo={matterbridgeInfo}/>}
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px - 40px)', maxHeight: 'calc(100vh - 60px - 40px)', width: '302px', minWidth: '302px', maxWidth: '302px', flex: '1 1 auto', gap: '20px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px - 40px)', maxHeight: 'calc(100vh - 60px - 40px)', flex: '1 1 auto', gap: '20px' }}>
  */

  if (wssHost === null) {
    return <div>Loading settings...</div>;
  }
  return (
    <div className="MbfPageDiv" style={{ flexDirection: 'row' }}>

    <ThemeProvider theme={theme}>

      <Dialog  open={openConfig} onClose={handleCloseConfig} maxWidth='600px' PaperProps={{style: { border: "2px solid #ddd", backgroundColor: '#c4c2c2', boxShadow: '5px 5px 10px #888'}}}>
        <DialogTitle gap={'20px'}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '20px' }}>
            <img src="matterbridge 64x64.png" alt="Matterbridge Logo" style={{ height: '64px', width: '64px' }} />
            <h3>Matterbridge plugin configuration</h3>
          </div>
        </DialogTitle>
        <DialogContent>
          <DialogConfigPlugin config={selectedPluginConfig} schema={selectedPluginSchema} handleCloseConfig={handleCloseConfig}/>
        </DialogContent>
      </Dialog>

      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '302px', minWidth: '302px', gap: '20px' }}>
        {qrCode && <QRDiv qrText={qrCode} pairingText={pairingCode} qrWidth={256} topText="QR pairing code" bottomText={selectedPluginName==='none'?'Matterbridge':selectedPluginName} matterbridgeInfo={matterbridgeInfo} plugin={selectedRow===-1?undefined:plugins[selectedRow]}/>}
        {systemInfo && <SystemInfoTable systemInfo={systemInfo} compact={true}/>}
        {qrCode==='' && matterbridgeInfo && <MatterbridgeInfoTable matterbridgeInfo={matterbridgeInfo}/>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', gap: '20px' }}>

        <div className="MbfWindowDiv" style={{ flex: '0 0 auto', width: '100%', overflow: 'hidden' }}>
          <div className="MbfWindowHeader">
            <p className="MbfWindowHeaderText">Add remove plugin</p>
          </div>
          <AddRemovePlugins ref={refAddRemove} plugins={plugins}/>
        </div>

        <div className="MbfWindowDiv" style={{ flex: '0 0 auto', width: '100%', overflow: 'hidden' }}>
          <div className="MbfWindowDivTable" style={{ flex: '0 0 auto', overflow: 'hidden' }}>
            <table ref={refRegisteredPlugins}>
              <thead>
                <tr>
                  <th colSpan="8">Registered plugins</th>
                </tr>
                <tr>
                  {columns.map((column, index) => (
                    <th key={index}>{column.Header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plugins.map((plugin, index) => (

                  <tr key={index} className={selectedRow === index ? 'table-content-selected' : index % 2 === 0 ? 'table-content-even' : 'table-content-odd'}>

                    <td><Tooltip title={plugin.path}>{plugin.name}</Tooltip></td>
                    <td>{plugin.description}</td>
                    <td><Tooltip title="Update the plugin to the latest version">{plugin.latestVersion === undefined || plugin.latestVersion === plugin.version ? plugin.version : <span className="status-warning" onClick={() => handleUpdate(index)}>{`${plugin.version} -> ${plugin.latestVersion}`}</span>}</Tooltip></td>
                    <td>{plugin.author.replace('https://github.com/', '')}</td>
                    <td>{plugin.type === 'DynamicPlatform'?'Dynamic':'Accessory'}</td>
                    <td>{plugin.registeredDevices}</td>
                    <td>  
                      <>
                        {matterbridgeInfo && matterbridgeInfo.bridgeMode === 'childbridge' ? <Tooltip title="Shows the QRCode or the fabrics"><IconButton style={{padding: 0}} className="PluginsIconButton" onClick={() => handleSelectQRCode(index)} size="small"><QrCode2 /></IconButton></Tooltip> : <></>}
                        <Tooltip title="Plugin config"><IconButton style={{padding: 0}} className="PluginsIconButton" onClick={() => handleConfigPlugin(index)} size="small"><Settings /></IconButton></Tooltip>
                        <Tooltip title="Remove the plugin"><IconButton style={{padding: 0}} className="PluginsIconButton" onClick={() => handleRemovePlugin(index)} size="small"><DeleteForever /></IconButton></Tooltip>
                        {plugin.enabled ? <Tooltip title="Disable the plugin"><IconButton style={{padding: 0}} className="PluginsIconButton" onClick={() => handleEnableDisable(index)} size="small"><Unpublished /></IconButton></Tooltip> : <></>}
                        {!plugin.enabled ? <Tooltip title="Enable the plugin"><IconButton style={{padding: 0}} className="PluginsIconButton" onClick={() => handleEnableDisable(index)} size="small"><PublishedWithChanges /></IconButton></Tooltip> : <></>}
                        <Tooltip title="Plugin help"><IconButton style={{padding: 0}} className="PluginsIconButton" onClick={() => handleHelpPlugin(index)} size="small"><Help /></IconButton></Tooltip>
                        <Tooltip title="Plugin version history"><IconButton style={{padding: 0}} className="PluginsIconButton" onClick={() => handleChangelogPlugin(index)} size="small"><Announcement /></IconButton></Tooltip>
                        <Tooltip title="Sponsor the plugin"><IconButton style={{padding: 0, color: '#b6409c'}} className="PluginsIconButton" onClick={() => handleSponsorPlugin(index)} size="small"><Favorite /></IconButton></Tooltip>
                      </>
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'row', flex: '1 1 auto', gap: '5px' }}>

                        <Snackbar anchorOrigin={{vertical: 'bottom', horizontal: 'right'}} open={openSnack} onClose={handleSnackClose} autoHideDuration={10000}>
                          <Alert onClose={handleSnackClose} severity="info" variant="filled" sx={{ width: '100%', bgcolor: '#4CAF50' }}>Restart needed!</Alert>
                        </Snackbar>
                        {plugin.error ? 
                          <>
                            <StatusIndicator status={false} enabledText='Error' disabledText='Error' tooltipText='The plugin is in error state. Check the log!'/></> :
                          <>
                            {plugin.enabled === false ?
                              <>
                                <StatusIndicator status={plugin.enabled} enabledText='Enabled' disabledText='Disabled' tooltipText='Whether the plugin is enable or disabled'/></> :
                              <>
                                {plugin.loaded && plugin.started && plugin.configured && plugin.paired && plugin.connected ? 
                                  <>
                                    <StatusIndicator status={plugin.loaded} enabledText='Running' tooltipText='Whether the plugin is running'/></> : 
                                  <>
                                    {plugin.loaded && plugin.started && plugin.configured && plugin.connected===undefined ? 
                                      <>
                                        <StatusIndicator status={plugin.loaded} enabledText='Running' tooltipText='Whether the plugin is running'/></> : 
                                      <>
                                        <StatusIndicator status={plugin.enabled} enabledText='Enabled' disabledText='Disabled' tooltipText='Whether the plugin is enable or disabled'/>
                                        <StatusIndicator status={plugin.loaded} enabledText='Loaded' tooltipText='Whether the plugin has been loaded'/>
                                        <StatusIndicator status={plugin.started} enabledText='Started' tooltipText='Whether the plugin started'/>
                                        <StatusIndicator status={plugin.configured} enabledText='Configured' tooltipText='Whether the plugin has been configured'/>
                                        {matterbridgeInfo && matterbridgeInfo.bridgeMode === 'childbridge' ? <StatusIndicator status={plugin.paired} enabledText='Paired' tooltipText='Whether the plugin has been paired'/> : <></>}
                                        {matterbridgeInfo && matterbridgeInfo.bridgeMode === 'childbridge' ? <StatusIndicator status={plugin.connected} enabledText='Connected' tooltipText='Whether the controller connected'/> : <></>}
                                      </>
                                    }
                                  </>
                                }
                              </>
                            }
                          </>
                        }
                      </div> 
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="MbfWindowDiv" style={{flex: '1 1 auto', width: '100%', overflow: 'hidden'}}>
          <div className="MbfWindowHeader" style={{ flexShrink: 0 }}>
            <p className="MbfWindowHeaderText" style={{ display: 'flex', justifyContent: 'space-between' }}>Logs <span style={{ fontWeight: 'normal' }}>Filter: debug level "{logDebugLevel}" and search "{logSearchCriteria}"</span></p>
          </div>
          <div style={{ flex: '1 1 auto', margin: '0px', padding: '0px', overflow: 'auto'}}>
            <WebSocketComponent wssHost={wssHost} debugLevel={logDebugLevel} searchCriteria={logSearchCriteria}/>
          </div>
        </div>

      </div>
    </ThemeProvider>  
    </div>
  );
}

/*
*/

function AddRemovePlugins({ plugins }) {
  const [pluginName, setPluginName] = useState('matterbridge-');
  const [open, setSnack] = useState(false);
  const [anchorEl, setAnchorEl] = React.useState(null);

  const handleSnackOpen = () => {
    console.log('handleSnackOpen');
    setSnack(true);
    setTimeout(() => {
      window.location.reload();
    }, 5000);
  };

  const handleSnackClose = (event, reason) => {
    console.log('handleSnackClose:', reason);
    if (reason === 'clickaway') return;
    setSnack(false);
  };

  // Function that sends the "addplugin" command
  const handleInstallPluginClick = () => {
    handleSnackOpen();
    console.log('handleInstallPluginClick', pluginName);
    sendCommandToMatterbridge('installplugin', pluginName);
  };

  // Function that sends the "addplugin" command
  const handleAddPluginClick = () => {
    handleSnackOpen();
    console.log('handleAddPluginClick', pluginName);
    sendCommandToMatterbridge('addplugin', pluginName);
  };

  // Function that sends the "removeplugin" command
  const handleRemovePluginClick = () => {
    handleSnackOpen();
    console.log('handleRemovePluginClick', pluginName);
    sendCommandToMatterbridge('removeplugin', pluginName);
  };

  const handleClickVertical = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleCloseMenu = (value) => {
    console.log('handleCloseMenu:', value);
    if(value !== '') setPluginName(value);
    setAnchorEl(null);
  };

  const theme = createTheme({
    palette: {
      primary: {
        main: '#4CAF50', // your custom primary color
      },
    },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'row', flex: '1 1 auto', alignItems: 'center', justifyContent: 'space-between', margin: '0px', padding: '10px', gap: '20px' }}>
      <Snackbar anchorOrigin={{vertical: 'bottom', horizontal: 'right'}} open={open} onClose={handleSnackClose} autoHideDuration={5000}>
        <Alert onClose={handleSnackClose} severity="info" variant="filled" sx={{ width: '100%', bgcolor: '#4CAF50' }}>Restart required</Alert>
      </Snackbar>
      <TextField value={pluginName} onChange={(event) => { setPluginName(event.target.value); }} size="small" id="plugin-name" label="Plugin name or plugin path" variant="outlined" fullWidth/>

      <IconButton onClick={handleClickVertical}>
        <MoreVert />
      </IconButton>
      <Menu id="simple-menu" anchorEl={anchorEl} keepMounted open={Boolean(anchorEl)} onClose={() => handleCloseMenu('')}>
        <MenuItem onClick={() => handleCloseMenu('matterbridge-zigbee2mqtt')}>matterbridge-zigbee2mqtt</MenuItem>
        <MenuItem onClick={() => handleCloseMenu('matterbridge-somfy-tahoma')}>matterbridge-somfy-tahoma</MenuItem>
        <MenuItem onClick={() => handleCloseMenu('matterbridge-shelly')}>matterbridge-shelly</MenuItem>
        <MenuItem onClick={() => handleCloseMenu('matterbridge-example-accessory-platform')}>matterbridge-example-accessory-platform</MenuItem>
        <MenuItem onClick={() => handleCloseMenu('matterbridge-example-dynamic-platform')}>matterbridge-example-dynamic-platform</MenuItem>
        <MenuItem onClick={() => handleCloseMenu('matterbridge-eve-door')}>matterbridge-eve-door</MenuItem>
        <MenuItem onClick={() => handleCloseMenu('matterbridge-eve-motion')}>matterbridge-eve-motion</MenuItem>
        <MenuItem onClick={() => handleCloseMenu('matterbridge-eve-energy')}>matterbridge-eve-energy</MenuItem>
        <MenuItem onClick={() => handleCloseMenu('matterbridge-eve-weather')}>matterbridge-eve-weather</MenuItem>
        <MenuItem onClick={() => handleCloseMenu('matterbridge-eve-room')}>matterbridge-eve-room</MenuItem>
      </Menu>

      <Tooltip title="Install or update a plugin from npm">
        <Button onClick={handleInstallPluginClick} theme={theme} color="primary" variant='contained' size="small" aria-label="install" endIcon={<Download />} style={{ color: '#ffffff', height: '30px', minWidth: '90px' }}> Install</Button>
      </Tooltip>        
      <Tooltip title="Add an installed plugin">
        <Button onClick={handleAddPluginClick} theme={theme} color="primary" variant='contained' size="small" aria-label="add" endIcon={<Add />} style={{ color: '#ffffff', height: '30px', minWidth: '90px' }}> Add</Button>
      </Tooltip>        
      <Tooltip title="Remove a registered plugin">
        <Button onClick={handleRemovePluginClick} theme={theme} color="primary" variant='contained' size="small" aria-label="remove" endIcon={<Remove />} style={{ color: '#ffffff', height: '30px', minWidth: '90px' }}> Remove</Button>
      </Tooltip>        
    </div>
  );
}

// This function takes systemInfo as a parameter and returns a table element with the systemInfo
function SystemInfoTable({ systemInfo, compact }) {
  const excludeKeys = ['totalMemory', 'osRelease', 'osArch'];
  if (compact && systemInfo.totalMemory) {
    const totalMemory = systemInfo.totalMemory;
    const freeMemory = systemInfo.freeMemory;
    systemInfo.freeMemory = `${freeMemory} / ${totalMemory}`;
    delete systemInfo.totalMemory;
  }
  if (compact && systemInfo.osRelease) {
    const osType = systemInfo.osType;
    const osRelease	= systemInfo.osRelease;
    systemInfo.osType = `${osType} (${osRelease})`;
    delete systemInfo.osRelease;
  }
  if(compact && systemInfo.osArch) {
    const osPlatform = systemInfo.osPlatform;
    const osArch = systemInfo.osArch;
    systemInfo.osPlatform = `${osPlatform} (${osArch})`;
    delete systemInfo.osArch;
  }

  return (
    <div className="MbfWindowDiv" style={{ minWidth: '302px' }}>
      <div className="MbfWindowDivTable">
        <table>
          <thead>
            <tr>
              <th colSpan="2">System Information</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(systemInfo).filter(([key, _]) => !excludeKeys.includes(key)).map(([key, value], index) => (
              <tr key={key} className={index % 2 === 0 ? 'table-content-even' : 'table-content-odd'} style={{ borderTop: '1px solid #ddd' }}>
                <td>{key}</td>
                <td>
                  <TruncatedText value={typeof value !== 'string' ? value.toString() : value} maxChars={26} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// This function takes systemInfo as a parameter and returns a table element with the systemInfo
function MatterbridgeInfoTable({ matterbridgeInfo }) {
  const excludeKeys = ['matterbridgeVersion', 'matterbridgeLatestVersion', 'matterLoggerLevel', 'debugEnabled', 'bridgeMode', 'matterbridgeFabricInformations', 'matterbridgeSessionInformations'];
  if(matterbridgeInfo.bridgeMode === 'childbridge') excludeKeys.push('matterbridgePaired', 'matterbridgeConnected');
  return (
    <div className="MbfWindowDiv" style={{ minWidth: '302px' }}>
      <div className="MbfWindowDivTable">
        <table>
          <thead>
            <tr>
              <th colSpan="2">Matterbridge Information</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(matterbridgeInfo)
              .filter(([key, value]) => !excludeKeys.includes(key) && value !== undefined && value !== '')
              .map(([key, value], index) => (
              <tr key={key} className={index % 2 === 0 ? 'table-content-even' : 'table-content-odd'} style={{ borderTop: '1px solid #ddd' }}>
                <td>{key.replace('matterbridgeConnected', 'connected').replace('matterbridgePaired', 'paired').replace('homeDirectory', 'home').replace('rootDirectory', 'root').replace('matterbridgeDirectory', 'storage').replace('matterbridgePluginDirectory', 'plugins').replace('globalModulesDirectory', 'modules')}</td>
                <td>
                  <TruncatedText value={typeof value !== 'string' ? value.toString() : value} maxChars={30} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TruncatedText({ value, maxChars }) {
  let displayText = value;
  if (value.length > maxChars && maxChars > 3) { 
    const charsToShow = maxChars - 3; 
    const start = value.substring(0, Math.ceil(charsToShow / 2));
    const end = value.substring(value.length - Math.floor(charsToShow / 2), value.length);
    displayText = `${start} … ${end}`;
  }
  if(value !== displayText) return (
    <Tooltip title={value} placement="top" PopperProps={{
      modifiers: [
        {
          name: 'offset',
          options: {
            offset: [0, 12], 
          },
        },
      ],
    }}>
      <span>{displayText}</span>
    </Tooltip>
  )
  else return <span>{displayText}</span>
}

function QRDiv({ qrText, pairingText, qrWidth, topText, bottomText, matterbridgeInfo, plugin }) {
  // console.log('QRDiv:', matterbridgeInfo, plugin);
  if(matterbridgeInfo.bridgeMode === 'bridge' && matterbridgeInfo.matterbridgePaired === true) 
    return ( 
      <div className="MbfWindowDiv" style={{alignItems: 'center', minWidth: '302px', overflow: 'hidden'}} >
        <div className="MbfWindowHeader">
          <p className="MbfWindowHeaderText" style={{textAlign: 'left', overflow: 'hidden'}}>Paired fabrics</p>
        </div>
        <div className="MbfWindowBodyColumn">
          {matterbridgeInfo.matterbridgeFabricInformations.map((fabric, index) => (
            <div key={index} style={{ margin: '0px', padding: '10px', gap: '0px', backgroundColor: '#9e9e9e', textAlign: 'left', fontSize: '14px' }}>
                <p className="status-blue" style={{ margin: '0px 10px 10px 10px', fontSize: '14px', padding: 0 }}>Fabric: {fabric.fabricIndex}</p>
                <p style={{ margin: '0px 20px 0px 20px'}}>Vendor: {fabric.rootVendorId} {fabric.rootVendorName}</p>
                {fabric.label !== '' && <p style={{ margin: '0px 20px 0px 20px'}}>Label: {fabric.label}</p>}
                <p style={{ margin: '0px 20px 0px 20px'}}>Active sessions: {matterbridgeInfo.matterbridgeSessionInformations.filter(session => session.fabric.fabricIndex === fabric.fabricIndex).length}</p>
            </div>  
          ))}
        </div>  
      </div>
  )  
  else if(matterbridgeInfo.bridgeMode === 'childbridge' && plugin && plugin.paired === true) 
    return ( 
      <div className="MbfWindowDiv" style={{alignItems: 'center', minWidth: '302px', overflow: 'hidden'}} >
        <div className="MbfWindowHeader">
          <p className="MbfWindowHeaderText" style={{textAlign: 'left'}}>Paired fabrics</p>
        </div>
        <div className="MbfWindowBodyColumn">
          {plugin.fabricInformations.map((fabric, index) => (
            <div key={index} style={{ margin: '0px', padding: '10px', gap: '0px', backgroundColor: '#9e9e9e', textAlign: 'left', fontSize: '14px' }}>
                <p className="status-blue" style={{ margin: '0px 10px 10px 10px', fontSize: '14px', padding: 0 }}>Fabric: {fabric.fabricIndex}</p>
                <p style={{ margin: '0px 20px 0px 20px' }}>Vendor: {fabric.rootVendorId} {fabric.rootVendorName}</p>
                {fabric.label !== '' && <p style={{ margin: '0px 20px 0px 20px'}}>Label: {fabric.label}</p>}
                <p style={{ margin: '0px 20px 0px 20px' }}>Active sessions: {plugin.sessionInformations.filter(session => session.fabric.fabricIndex === fabric.fabricIndex).length}</p>
            </div>  
          ))}
        </div>  
      </div>
  )
  else if(matterbridgeInfo.bridgeMode === 'bridge' && matterbridgeInfo.matterbridgePaired !== true) 
    return (
      <div className="MbfWindowDiv" style={{alignItems: 'center', minWidth: '302px'}}>
        <div className="MbfWindowHeader">
          <p className="MbfWindowHeaderText" style={{textAlign: 'left'}}>{topText}</p>
        </div>
        <QRCode value={qrText} size={qrWidth} bgColor='#9e9e9e' style={{ margin: '20px' }}/>
        <div className="MbfWindowFooter" style={{padding: 0, marginTop: '-5px', height: '30px'}}>
          <div>
            <p style={{ margin: 0, textAlign: 'center', fontSize: '14px' }}>Manual pairing code: {pairingText}</p>
          </div>
        </div>
      </div>
    );
  else if(matterbridgeInfo.bridgeMode === 'childbridge' && plugin && plugin.paired !== true)  
    return (
      <div className="MbfWindowDiv" style={{alignItems: 'center', minWidth: '302px'}}>
        <div className="MbfWindowHeader">
          <p className="MbfWindowHeaderText" style={{textAlign: 'left'}}>{topText}</p>
        </div>
        <QRCode value={qrText} size={qrWidth} bgColor='#9e9e9e' style={{ margin: '20px' }}/>
        <div className="MbfWindowFooter" style={{padding: 0, marginTop: '-5px', height: '30px'}}>
          <div>
            <p style={{ margin: 0, textAlign: 'center', fontSize: '14px' }}>Manual pairing code: {pairingText}</p>
          </div>
        </div>
      </div>
    );
}

function DialogConfigPlugin( { config, schema, handleCloseConfig }) {
  console.log('DialogConfigPlugin:', config, schema);
  const uiSchema = {
    "password": {
      "ui:widget": "password",
    },
    "ui:submitButtonOptions": {
      "props": {
        "variant": "contained",
        "disabled": false,
      },
      "norender": false,
      "submitText": "Save the changes to the config file",
    },
    'ui:globalOptions': { orderable: false },
  };
  const theme = createTheme({
    palette: {
      primary: {
        main: '#4CAF50', 
      },
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            border: "1px solid #ddd", 
            backgroundColor: '#c4c2c2', 
            boxShadow: '5px 5px 10px #888'
          },
        },
      },
      MuiTextField: {
        defaultProps: {
          size: 'small',
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            color: '#ffffff',
            backgroundColor: '#4CAF50', 
          },
        },
        defaultProps: {
          color: 'primary',
          variant: 'contained',
          size: 'small',
        },
      },
    },
  });
  const handleSaveChanges = ({ formData }, event) => {
    console.log('handleSaveChanges:', formData);
    const config = JSON.stringify(formData, null, 2)
    sendCommandToMatterbridge('saveconfig', formData.name, config);
    // Close the dialog
    handleCloseConfig();
    window.location.reload();
  };    
  return (
  <ThemeProvider theme={theme}>
    <div style={{ maxWidth: '800px' }}>
      <Form schema={schema} formData={config} uiSchema={uiSchema} validator={validator} onSubmit={handleSaveChanges} />
      <div style={{ paddingTop: '10px' }}>Restart Matterbridge to apply the changes</div>
    </div>
  </ThemeProvider>  
  );
}
  
export default Home;
