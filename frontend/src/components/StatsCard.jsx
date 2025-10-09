import { formatUGX } from "./currency";
import { IconType } from 'react-icons';

const StatsCard = ({ title, value, icon: Icon, change, changeType = 'neutral', format = 'text' }) => {
  const formatValue = (val) => {
    if (format === 'currency') return formatUGX(val);
    if (format === 'data') {
      return `${val.toFixed(1)} GB`;
    }
    if (format === 'percentage') {
      return `${val}%`;
    }
    return val.toLocaleString();
  };

  const getChangeColor = () => {
    switch (changeType) {
      case 'positive':
        return 'text-success-600 dark:text-success-400';
      case 'negative':
        return 'text-danger-600 dark:text-danger-400';
      default:
        return 'text-gray-600 dark:text-gray-400';
    }
  };

  const getChangeIcon = () => {
    switch (changeType) {
      case 'positive':
        return '↗';
      case 'negative':
        return '↘';
      default:
        return '→';
    }
  };

  return (
    <div className="yaba-card">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium yaba-muted mb-1">
            {title}
          </p>
          <p className="text-2xl font-bold" style={{color: 'var(--text-primary)'}}>
            {formatValue(value)}
          </p>
          {change !== undefined && (
            <div className={`flex items-center text-sm font-medium ${getChangeColor()}`}>
              <span className="mr-1">{getChangeIcon()}</span>
              {change}
            </div>
          )}
        </div>
        <div className="p-3 bg-primary-100 dark:bg-primary-900/20 rounded-lg">
          <Icon className="w-6 h-6 text-primary-600 dark:text-primary-400" />
        </div>
      </div>
    </div>
  );
};

export default StatsCard;
