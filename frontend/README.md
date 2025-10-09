# WiFi Business Hub - Frontend

A comprehensive admin dashboard for WiFi hotspot business owners to manage their operations across multiple locations.

## Features

### 🎯 Core Dashboard
- **At-a-Glance Summary**: Total revenue, customers, active users, and data usage
- **Multi-Hotspot Management**: Manage multiple WiFi locations from a single interface
- **Real-time Monitoring**: Track hotspot status and performance
- **Financial Management**: Revenue tracking and payout systems

### 📊 Analytics & Reporting
- **Revenue Trends**: Interactive charts showing business performance over time
- **Package Performance**: Breakdown of which WiFi packages sell best
- **Data Usage Analytics**: Hourly consumption patterns
- **User Demographics**: Customer behavior insights

### 🔧 Management Tools
- **Hotspot Management**: Add, remove, and monitor WiFi devices
- **Package Management**: Create and manage WiFi packages (time-based, data-based, unlimited)
- **Voucher System**: Generate and track prepaid vouchers
- **Device Monitoring**: Real-time status and troubleshooting

### 💰 Financial Features
- **Balance Tracking**: Current available funds
- **Transaction History**: Complete payment records
- **Payout System**: Mobile money integration
- **Revenue Attribution**: Track earnings by location

## Getting Started

### Prerequisites
- Node.js 18+ 
- npm or pnpm

### Installation
```bash
cd frontend
npm install
```

### Development
```bash
npm run dev
```

The dashboard will be available at `http://localhost:5173`

### Build for Production
```bash
npm run build
```

## Project Structure

```
src/
├── components/           # Reusable UI components
│   ├── charts/          # Chart components (Line, Pie, Area)
│   ├── StatsCard.jsx    # Metric display cards
│   └── ThemeToggle.jsx  # Dark/light mode toggle
├── contexts/            # React contexts
│   └── ThemeContext.jsx # Theme management
├── data/               # Mock data and configurations
│   └── wifiMockData.js # Default data structures
├── AdminDashboard.jsx # Main dashboard component (merged with WifiAdminDashboard)
└── main.jsx           # Application entry point
```

## Default Configuration

All metrics start at 0 as default values:
- **Revenue**: UGX 0.00
- **Customers**: 0
- **Active Users**: 0
- **Data Used**: 0.0 GB
- **Hotspots**: 3 sample locations (offline by default)

## Technology Stack

- **React 19**: Modern React with hooks
- **Tailwind CSS**: Utility-first CSS framework
- **Recharts**: Data visualization library
- **React Icons**: Icon library
- **Vite**: Build tool and dev server

## Features in Detail

### 1. Overview Dashboard
- Key performance indicators
- Revenue and customer trends
- Data usage patterns
- Package performance breakdown

### 2. Device Management
- Hotspot status monitoring
- Location-based filtering
- Device ID tracking
- Performance metrics per location

### 3. Package Management
- Time-based packages (hours, days)
- Data-based packages (MB, GB)
- Unlimited access options
- Pricing configuration

### 4. Financial Management
- Current balance display
- Transaction history
- Payout requests
- Revenue attribution

## Future Enhancements

- Real-time data integration
- Advanced analytics and predictions
- Mobile app development
- Multi-tenant support
- API integrations
- Custom reporting

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

This project is licensed under the MIT License.
