import { LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const LineChart = ({ data, title }) => {
  const formatCurrency = (value) => `UGX ${value.toLocaleString()}`;
  const formatNumber = (value) => value.toLocaleString();

  return (
    <div className="w-full h-80">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsLineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis 
            dataKey="date" 
            stroke="#6b7280"
            fontSize={12}
          />
          <YAxis 
            yAxisId="left"
            stroke="#3b82f6"
            fontSize={12}
            tickFormatter={formatCurrency}
          />
          <YAxis 
            yAxisId="right" 
            orientation="right" 
            stroke="#10b981"
            fontSize={12}
            tickFormatter={formatNumber}
          />
          <Tooltip 
            contentStyle={{
              backgroundColor: 'var(--surface)',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
            }}
            formatter={(value, name) => [
              name === 'revenue' ? formatCurrency(value) : formatNumber(value),
              name === 'revenue' ? 'Revenue' : 'Customers'
            ]}
          />
          <Legend />
          <Line 
            yAxisId="left"
            type="monotone" 
            dataKey="revenue" 
            stroke="#3b82f6" 
            strokeWidth={3}
            dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6, stroke: '#3b82f6', strokeWidth: 2 }}
          />
          <Line 
            yAxisId="right"
            type="monotone" 
            dataKey="customers" 
            stroke="#10b981" 
            strokeWidth={3}
            dot={{ fill: '#10b981', strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6, stroke: '#10b981', strokeWidth: 2 }}
          />
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default LineChart;
