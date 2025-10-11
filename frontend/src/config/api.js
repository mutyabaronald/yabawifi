// API Configuration
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export const apiConfig = {
  baseURL: API_BASE_URL,
  endpoints: {
    // User endpoints
    userAuth: '/api/users/auth',
    userDashboard: '/api/users/dashboard',
    
    // Admin endpoints
    adminLogin: '/api/owners/login',
    adminDashboard: '/api/owners/dashboard',
    adminStats: '/api/statistics',
    
    // Super admin endpoints
    superAdminLogin: '/api/admin/superadmin/login',
    superDashboard: '/api/super',
    
    // General endpoints
    health: '/api/health',
    contactInfo: '/api/super/contact-info',
    reviews: '/api/statistics/reviews',
    dailyUsers: '/api/statistics/daily-users',
    
    // Voucher endpoints
    vouchers: '/api/vouchers',
    
    // Package endpoints
    packages: '/api/packages',
    
    // Hotspot endpoints
    hotspots: '/api/hotspots',
    
    // Loyalty endpoints
    loyalty: '/api/loyalty',
    
    // Support endpoints
    support: '/api/support',
    
    // MTN payment endpoints
    mtnPayment: '/api/mtn',
  }
};

// Helper function to build full API URLs
export const buildApiUrl = (endpoint) => {
  return `${apiConfig.baseURL}${endpoint}`;
};

// Helper function for API calls with proper error handling
export const apiCall = async (endpoint, options = {}) => {
  const url = buildApiUrl(endpoint);
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };
  
  try {
    const response = await fetch(url, { ...defaultOptions, ...options });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('API call failed:', error);
    throw error;
  }
};

export default apiConfig;
