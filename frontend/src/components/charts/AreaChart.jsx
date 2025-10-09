import { AreaChart as RechartsAreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const AreaChart = ({ data, title }) => {
  const formatData = (value) => `${value.toFixed(1)} GB`;

  return (
    <div className="w-full h-80">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsAreaChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis 
            dataKey="hour" 
            stroke="#6b7280"
            fontSize={12}
          />
          <YAxis 
            stroke="#8b5cf6"
            fontSize={12}
            tickFormatter={formatData}
          />
          <Tooltip 
            formatter={(value) => [formatData(value), 'Data Usage']}
            contentStyle={{
              backgroundColor: 'var(--surface)',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
            }}
          />
          <Area 
            type="monotone" 
            dataKey="usage" 
            stroke="#8b5cf6" 
            fill="#8b5cf6"
            fillOpacity={0.3}
            strokeWidth={2}
          />
        </RechartsAreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default AreaChart;
