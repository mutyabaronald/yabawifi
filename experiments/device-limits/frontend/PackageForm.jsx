import React, { useState } from 'react';

export default function PackageForm({ ownerId, onCreated }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState(60);
  const [deviceLimit, setDeviceLimit] = useState(1);

  async function createPackage(e) {
    e.preventDefault();
    const res = await fetch(`/api/packages/${ownerId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, price: Number(price), durationMinutes: Number(duration), deviceLimit: Number(deviceLimit) })
    });
    const data = await res.json();
    if (data.id) { setName(''); setPrice(''); setDuration(60); setDeviceLimit(1); onCreated && onCreated(data.id); alert('Package created'); }
    else { alert('Error creating package'); }
  }

  return (
    <form onSubmit={createPackage} className="space-y-3">
      <div><input required value={name} onChange={e=>setName(e.target.value)} placeholder="Package name" /></div>
      <div><input required type="number" value={price} onChange={e=>setPrice(e.target.value)} placeholder="Price" /></div>
      <div><input required type="number" value={duration} onChange={e=>setDuration(e.target.value)} placeholder="Duration (minutes)" /></div>
      <div>
        <label>Device limit per purchase</label>
        <input required type="number" min="1" max="10" value={deviceLimit} onChange={e=>setDeviceLimit(e.target.value)} />
      </div>
      <div><button type="submit">Create Package</button></div>
    </form>
  );
}


