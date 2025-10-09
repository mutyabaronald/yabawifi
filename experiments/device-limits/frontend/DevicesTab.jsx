import React, { useEffect, useState, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import 'chart.js/auto';

export default function DevicesTab({ ownerId }) {
  const [devices, setDevices] = useState([]);
  const [chartData, setChartData] = useState({ labels: [], datasets: [{ label: 'Online devices', data: [] }] });
  const historyRef = useRef([]);

  useEffect(() => {
    let mounted = true;
    async function fetchDevices() {
      const res = await fetch(`/api/devices/owner/${ownerId}`);
      const data = await res.json();
      if (!mounted) return;
      setDevices(data);
      const onlineCount = data.filter(d => d.status === 'online').length;
      const now = new Date().toLocaleTimeString();
      historyRef.current = [...historyRef.current, { t: now, v: onlineCount }].slice(-12);
      setChartData({ labels: historyRef.current.map(h => h.t), datasets: [{ label: 'Online devices', data: historyRef.current.map(h => h.v) }] });
    }
    fetchDevices();
    const id = setInterval(fetchDevices, 8000);
    return () => { mounted = false; clearInterval(id); };
  }, [ownerId]);

  return (
    <div>
      <h2>Connected Devices ({devices.length})</h2>
      <div style={{ maxWidth: 600 }}><Line data={chartData} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px,1fr))', gap: 12, marginTop: 12 }}>
        {devices.map((d, i) => (
          <div key={i} style={{ border: '1px solid #eee', padding: 12, borderRadius: 8 }}>
            <div><strong>{d.deviceName || 'Unknown Device'}</strong></div>
            <div>MAC: {d.macAddress}</div>
            <div>IP: {d.ipAddress || 'N/A'}</div>
            <div>Status: <b>{d.status}</b></div>
            <div>User: {d.userId}</div>
          </div>
        ))}
      </div>
    </div>
  );
}


