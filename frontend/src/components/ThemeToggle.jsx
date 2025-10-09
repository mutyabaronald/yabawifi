import { useTheme } from '../contexts/ThemeContext';
import { FiSun, FiMoon } from 'react-icons/fi';

const ThemeToggle = () => {
  const { theme, toggleTheme, isDark } = useTheme();

  const buttonStyle = {
    padding: '8px',
    borderRadius: '8px',
    border: 'none',
    cursor: 'pointer',
    backgroundColor: isDark ? '#1f2329' : '#f3f4f6',
    color: isDark ? '#e7e9ee' : '#374151',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const iconStyle = {
    width: '20px',
    height: '20px',
  };

  return (
    <button
      onClick={toggleTheme}
      style={buttonStyle}
      onMouseEnter={(e) => {
        e.target.style.backgroundColor = isDark ? '#2a2f36' : '#e5e7eb';
      }}
      onMouseLeave={(e) => {
        e.target.style.backgroundColor = isDark ? '#1f2329' : '#f3f4f6';
      }}
      aria-label="Toggle theme"
    >
      {theme === 'light' ? (
        <FiMoon style={iconStyle} />
      ) : (
        <FiSun style={iconStyle} />
      )}
    </button>
  );
};

export default ThemeToggle;
