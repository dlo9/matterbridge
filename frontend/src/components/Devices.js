/* eslint-disable no-console */
// Devices.js
import React, { useEffect, useState } from 'react';

function Devices() {
  const [devices, setDevices] = useState([]);
  const [sortColumn, setSortColumn] = useState(undefined);
  const [sortDirection, setSortDirection] = useState(undefined); // true for ascending, false for descending
  const [selectedRow, setSelectedRow] = useState(-1); // -1 no selection, 0 or greater for selected row
  const [selectedPluginName, setSelectedPluginName] = useState('none'); // -1 no selection, 0 or greater for selected row
  const [selectedDeviceEndpoint, setSelectedDeviceEndpoint] = useState('none'); // -1 no selection, 0 or greater for selected row
  const [clusters, setClusters] = useState([]);

  useEffect(() => {
    // Fetch Devices
    fetch('/api/devices')
      .then(response => response.json())
      .then(data => setDevices(data))
      .catch(error => console.error('Error fetching devices:', error));

  }, []);

  useEffect(() => {
    // Fetch Devices
    fetch(`/api/devices_clusters/${selectedPluginName}/${selectedDeviceEndpoint}`)
      .then(response => response.json())
      .then(data => setClusters(data))
      .catch(error => console.error('Error fetching devices_clusters:', error));

  }, [selectedDeviceEndpoint, selectedPluginName]);
  
  const handleSort = (column) => {
    if (sortColumn === column) {
      if(sortDirection===undefined) setSortDirection(true);
      if(sortDirection===true) setSortDirection(false);
      if(sortDirection===false) setSortColumn(undefined);
      if(sortDirection===false) setSortDirection(undefined);
      // setSortDirection(!sortDirection);
    } else {
      setSortColumn(column);
      setSortDirection(true);
    }
  };

  const handleSelect = (row) => {
    if (selectedRow === row) {
      setSelectedRow(-1);
      setSelectedPluginName('none');
      setSelectedDeviceEndpoint('none');
    } else {
      setSelectedRow(row);
      setSelectedPluginName(sortedDevices[row].pluginName);
      setSelectedDeviceEndpoint(sortedDevices[row].endpoint);
    }
    console.log('Selected row:', row);
    console.log('Selected plugin:', sortedDevices[row].pluginName);
    console.log('Selected endpoint:', sortedDevices[row].endpoint);
  };

  const sortedDevices = [...devices].sort((a, b) => {
    if (a[sortColumn] < b[sortColumn]) {
      return sortDirection ? -1 : 1;
    }
    if (a[sortColumn] > b[sortColumn]) {
      return sortDirection ? 1 : -1;
    }
    return 0;
  })

  return (
    <div className="MbfPageDiv">
      <div className="MbfWindowDiv" style={{ flex: '1 1 auto', maxHeight: '50%', width: '100%', overflow: 'hidden' }}>
        <div className="MbfWindowDivTable">
          <table>
            <thead>
              <tr>
                <th colSpan="7">Registered devices</th>
              </tr>
              <tr>
                <th onClick={() => handleSort('pluginName')}>Plugin name {sortColumn === 'pluginName' ? (sortDirection ? ' 🔼' : ' 🔽') : ' 🔼🔽'}</th>
                <th onClick={() => handleSort('type')}>Device type {sortColumn === 'type' ? (sortDirection ? ' 🔼' : ' 🔽') : ' 🔼🔽'}</th>
                <th onClick={() => handleSort('endpoint')}>Endpoint {sortColumn === 'endpoint' ? (sortDirection ? ' 🔼' : ' 🔽') : ' 🔼🔽'}</th>
                <th onClick={() => handleSort('name')}>Name {sortColumn === 'name' ? (sortDirection ? ' 🔼' : ' 🔽') : ' 🔼🔽'}</th>
                <th onClick={() => handleSort('serial')}>Serial number {sortColumn === 'serial' ? (sortDirection ? ' 🔼' : ' 🔽') : ' 🔼🔽'}</th>
                <th onClick={() => handleSort('uniqueId')}>Unique ID {sortColumn === 'uniqueId' ? (sortDirection ? ' 🔼' : ' 🔽') : ' 🔼🔽'}</th>
                <th onClick={() => handleSort('cluster')}>Cluster {sortColumn === 'cluster' ? (sortDirection ? ' 🔼' : ' 🔽') : ' 🔼🔽'}</th>
              </tr>
            </thead>
            <tbody>
              {sortedDevices.map((device, index) => (
                <tr key={index} onClick={() => handleSelect(index)} className={selectedRow === index ? 'table-content-selected' : index % 2 === 0 ? 'table-content-even' : 'table-content-odd'}>
                  <td>{device.pluginName}</td>
                  <td>{device.type}</td>
                  <td>{device.endpoint}</td>
                  <td>{device.name}</td>
                  <td>{device.serial}</td>
                  <td>{device.uniqueId}</td>
                  <td>{device.cluster}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="MbfWindowDiv" style={{ flex: '1 1 auto', maxHeight: '50%', width: '100%', overflow: 'hidden' }}>
        <div className="MbfWindowDivTable">
          <table>
            <thead>
              <tr>
                <th colSpan="3">{selectedRow>=0?'Cluster servers of '+sortedDevices[selectedRow].name:'(select a device)'}</th>
                <th colSpan="3">Attributes</th>
              </tr>
              <tr>
                <th>Endpoint</th>
                <th>Name</th>
                <th>Id</th>
                <th>Name</th>
                <th>Id</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {clusters.map((cluster, index) => (
                <tr key={index} className={index % 2 === 0 ? 'table-content-even' : 'table-content-odd'}>
                  <td>{cluster.endpoint}</td>
                  <td>{cluster.clusterName}</td>
                  <td>{cluster.clusterId}</td>
                  <td>{cluster.attributeName}</td>
                  <td>{cluster.attributeId}</td>
                  <td>{cluster.attributeValue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default Devices;