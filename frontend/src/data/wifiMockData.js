// Default dashboard statistics - all set to 0 as per requirements
export const dashboardStats = {
  totalRevenue: 0.00,
  totalCustomers: 0,
  activeUsers: 0,
  dataUsed: 0.0,
  hotspotStatus: 'offline',
  currentBalance: 0.00,
  totalHotspots: 0,
  onlineHotspots: 0
};

// Default packages configuration
export const packages = [
  { id: 1, name: '1 Hour', price: 0.00, type: 'time', value: 1, unit: 'hour', active: false },
  { id: 2, name: '3 Hours', price: 0.00, type: 'time', value: 3, unit: 'hours', active: false },
  { id: 3, name: '1 GB', price: 0.00, type: 'data', value: 1, unit: 'GB', active: false },
  { id: 4, name: '3 GB', price: 0.00, type: 'data', value: 3, unit: 'GB', active: false },
  { id: 5, name: 'Daily Pass', price: 0.00, type: 'unlimited', value: 24, unit: 'hours', active: false }
];

// Default hotspots data structure
export const hotspots = [
  {
    id: 'HS001',
    name: 'Downtown Cafe',
    location: 'Main Street, Downtown',
    status: 'offline',
    activeUsers: 0,
    totalRevenue: 0.00,
    totalCustomers: 0,
    dataUsed: 0.0,
    lastSeen: 'Never',
    deviceId: 'DEV-001-CAFE',
    loyaltyEnabled: false
  },
  {
    id: 'HS002',
    name: 'Shopping Mall',
    location: 'Central Mall, City Center',
    status: 'offline',
    activeUsers: 0,
    totalRevenue: 0.00,
    totalCustomers: 0,
    dataUsed: 0.0,
    lastSeen: 'Never',
    deviceId: 'DEV-002-MALL',
    loyaltyEnabled: false
  },
  {
    id: 'HS003',
    name: 'University Campus',
    location: 'Main Campus, University District',
    status: 'offline',
    activeUsers: 0,
    totalRevenue: 0.00,
    totalCustomers: 0,
    dataUsed: 0.0,
    lastSeen: 'Never',
    deviceId: 'DEV-003-UNI',
    loyaltyEnabled: false
  }
];

// Default vouchers data
export const vouchers = [
  {
    id: 'V001',
    package: '1 Hour',
    status: 'unused',
    createdDate: '2024-08-28',
    usedDate: null,
    hotspot: null
  },
  {
    id: 'V002',
    package: '3 Hours',
    status: 'unused',
    createdDate: '2024-08-28',
    usedDate: null,
    hotspot: null
  }
];

// Default transactions data
export const transactions = [
  {
    id: 'T001',
    type: 'payment',
    amount: 0.00,
    description: '1 Hour Package',
    date: '2024-08-28 14:30',
    hotspot: 'HS001'
  }
];

// Default notifications data
export const notifications = [
  {
    id: 1,
    type: 'info',
    message: 'Welcome to your WiFi Business Hub Dashboard!',
    priority: 'low',
    read: false,
    hotspot: null,
    timestamp: '2024-08-28 10:00'
  }
];

// Chart data for revenue trends (empty initially)
export const revenueChartData = [
  { date: '2024-08-22', revenue: 0, customers: 0 },
  { date: '2024-08-23', revenue: 0, customers: 0 },
  { date: '2024-08-24', revenue: 0, customers: 0 },
  { date: '2024-08-25', revenue: 0, customers: 0 },
  { date: '2024-08-26', revenue: 0, customers: 0 },
  { date: '2024-08-27', revenue: 0, customers: 0 },
  { date: '2024-08-28', revenue: 0, customers: 0 }
];

// Chart data for data usage (empty initially)
export const dataUsageChartData = [
  { hour: '00:00', usage: 0 },
  { hour: '06:00', usage: 0 },
  { hour: '12:00', usage: 0 },
  { hour: '18:00', usage: 0 },
  { hour: '23:59', usage: 0 }
];

// Package performance data (empty initially)
export const packagePerformanceData = [
  { name: '1 Hour', value: 0, color: '#3b82f6' },
  { name: '3 Hours', value: 0, color: '#10b981' },
  { name: '1 GB', value: 0, color: '#f59e0b' },
  { name: '3 GB', value: 0, color: '#ef4444' },
  { name: 'Daily Pass', value: 0, color: '#8b5cf6' }
];
