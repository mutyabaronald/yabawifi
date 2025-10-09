import { formatUGX } from "./currency";
import React, { useState, useEffect } from 'react';

const TransactionsSection = ({ transactions }) => {
  const [filterType, setFilterType] = useState('all');
  const [sortBy, setSortBy] = useState('date');
  const [filteredTransactions, setFilteredTransactions] = useState([]);

  // Calculate summary metrics
  const totalSpent = transactions
    .filter(t => t.type === 'purchase' && t.amount)
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  const totalSaved = transactions
    .filter(t => (t.type === 'voucher' || t.type === 'points') && t.originalPrice)
    .reduce((sum, t) => sum + (t.originalPrice || 0), 0);

  const totalTransactions = transactions.length;

  // Filter and sort transactions
  useEffect(() => {
    let filtered = [...transactions];

    // Apply filter
    if (filterType !== 'all') {
      filtered = filtered.filter(t => t.type === filterType);
    }

    // Apply sorting
    filtered.sort((a, b) => {
      if (sortBy === 'date') {
        return new Date(b.time || b.createdAt || 0) - new Date(a.time || a.createdAt || 0);
      } else if (sortBy === 'amount') {
        return (b.amount || 0) - (a.amount || 0);
      } else if (sortBy === 'type') {
        return (a.type || '').localeCompare(b.type || '');
      }
      return 0;
    });

    setFilteredTransactions(filtered);
  }, [transactions, filterType, sortBy]);

  const formatCurrency = (amount) => {
    if (!amount) return formatUGX(0);
    return formatUGX(amount);
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatTime = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  };

  const getTransactionIcon = (transaction) => {
    switch (transaction.type) {
      case 'purchase':
        return '💰';
      case 'voucher':
        return '🎫';
      case 'points':
        return '⭐';
      default:
        return '📦';
    }
  };

  const getTransactionTypeLabel = (transaction) => {
    switch (transaction.type) {
      case 'purchase':
        return 'Purchase';
      case 'voucher':
        return 'Voucher';
      case 'points':
        return 'Points Used';
      default:
        return 'Transaction';
    }
  };

  const getStatusLabel = (transaction) => {
    return transaction.status || 'completed';
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return { bg: '#dcfce7', text: '#166534' };
      case 'pending':
        return { bg: '#fef3c7', text: '#92400e' };
      case 'failed':
        return { bg: '#fee2e2', text: '#dc2626' };
      default:
        return { bg: '#f3f4f6', text: '#374151' };
    }
  };

  const getTypeColor = (type) => {
    switch (type) {
      case 'purchase':
        return { bg: '#dbeafe', text: '#1e40af' };
      case 'voucher':
        return { bg: '#dcfce7', text: '#166534' };
      case 'points':
        return { bg: '#f3e8ff', text: '#7c3aed' };
      default:
        return { bg: '#f3f4f6', text: '#374151' };
    }
  };

  return (
    <div style={styles.container}>
      {/* Header Section */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.title}>Transaction History</h1>
          <p style={styles.subtitle}>Track all your WiFi purchases and activities</p>
        </div>
      </div>

      {/* Summary Metrics Section */}
      <div style={styles.metricsGrid}>
        <div style={styles.metricCard}>
          <div style={styles.metricIcon}>💰</div>
          <div style={styles.metricContent}>
            <div style={styles.metricLabel}>Total Spent</div>
            <div style={styles.metricValue}>{formatCurrency(totalSpent)}</div>
          </div>
        </div>

        <div style={styles.metricCard}>
          <div style={styles.metricIcon}>💚</div>
          <div style={styles.metricContent}>
            <div style={styles.metricLabel}>Total Saved</div>
            <div style={styles.metricValue}>{formatCurrency(totalSaved)}</div>
          </div>
        </div>

        <div style={styles.metricCard}>
          <div style={styles.metricIcon}>📊</div>
          <div style={styles.metricContent}>
            <div style={styles.metricLabel}>Total Transactions</div>
            <div style={styles.metricValue}>{totalTransactions}</div>
          </div>
        </div>
      </div>

      {/* Filter and Sort Section */}
      <div style={styles.filterSection}>
        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>Filter by:</label>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="all">All Transactions</option>
            <option value="purchase">Purchases</option>
            <option value="voucher">Vouchers</option>
            <option value="points">Points Used</option>
          </select>
        </div>

        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>Sort by:</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="date">Date</option>
            <option value="amount">Amount</option>
            <option value="type">Type</option>
          </select>
        </div>
      </div>

      {/* Transactions List Section */}
      <div style={styles.transactionsSection}>
        <h3 style={styles.sectionTitle}>All Transactions</h3>
        
        {filteredTransactions.length === 0 ? (
          <div style={styles.emptyState}>
            <p style={styles.emptyText}>No transactions found</p>
            <p style={styles.emptySubtext}>
              {filterType === 'all' 
                ? 'Start by purchasing a WiFi package or redeeming a voucher'
                : `No ${filterType} transactions found`
              }
            </p>
          </div>
        ) : (
          <div style={styles.transactionsList}>
            {filteredTransactions.map((transaction, index) => (
              <div key={transaction.id || index} style={styles.transactionItem}>
                <div style={styles.transactionIcon}>
                  {getTransactionIcon(transaction)}
                </div>
                
                <div style={styles.transactionContent}>
                  <div style={styles.transactionHeader}>
                    <h4 style={styles.transactionTitle}>
                      {transaction.packageName || transaction.package || 'WiFi Access'}
                    </h4>
                    <div style={styles.transactionTags}>
                      <span 
                        style={{
                          ...styles.typeTag,
                          backgroundColor: getTypeColor(transaction.type).bg,
                          color: getTypeColor(transaction.type).text
                        }}
                      >
                        {getTransactionTypeLabel(transaction)}
                      </span>
                      <span 
                        style={{
                          ...styles.statusTag,
                          backgroundColor: getStatusColor(getStatusLabel(transaction)).bg,
                          color: getStatusColor(getStatusLabel(transaction)).text
                        }}
                      >
                        {getStatusLabel(transaction)}
                      </span>
                    </div>
                  </div>
                  
                  <div style={styles.transactionDetails}>
                    <span style={styles.transactionLocation}>
                      {transaction.hotspotName || transaction.ownerName || 'WiFi Hotspot'}
                    </span>
                    <span style={styles.transactionSeparator}>•</span>
                    <span style={styles.transactionDate}>
                      {formatDate(transaction.time || transaction.createdAt)}
                    </span>
                    <span style={styles.transactionSeparator}>•</span>
                    <span style={styles.transactionTime}>
                      {formatTime(transaction.time || transaction.createdAt)}
                    </span>
                  </div>
                  
                  <div style={styles.transactionInfo}>
                    {transaction.type === 'purchase' && (
                      <span style={styles.paymentInfo}>
                        Payment: Mobile Money
                      </span>
                    )}
                    {transaction.type === 'voucher' && (
                      <span style={styles.voucherInfo}>
                        Voucher: {transaction.voucherCode || 'N/A'}
                      </span>
                    )}
                    {transaction.type === 'points' && (
                      <span style={styles.pointsInfo}>
                        Points used: {transaction.pointsUsed || 'N/A'}
                      </span>
                    )}
                  </div>
                </div>
                
                <div style={styles.transactionRight}>
                  <div style={styles.transactionAmount}>
                    {transaction.type === 'voucher' || transaction.type === 'points' 
                      ? 'FREE' 
                      : formatCurrency(transaction.amount)
                    }
                  </div>
                  {transaction.loyaltyPointsEarned && (
                    <div style={styles.pointsEarned}>
                      +{transaction.loyaltyPointsEarned} points earned
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const styles = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '20px',
  },
  header: {
    marginBottom: '30px',
  },
  title: {
    fontSize: '32px',
    fontWeight: 'bold',
    color: 'var(--text-primary)',
    margin: '0 0 8px 0',
  },
  subtitle: {
    fontSize: '16px',
    color: '#6b7280',
    margin: 0,
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '20px',
    marginBottom: '30px',
  },
  metricCard: {
    backgroundColor: 'var(--surface)',
    borderRadius: '12px',
    padding: '24px',
    border: '1px solid var(--stroke)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  metricIcon: {
    fontSize: '32px',
    width: '48px',
    height: '48px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '8px',
  },
  metricContent: {
    flex: 1,
  },
  metricLabel: {
    fontSize: '14px',
    color: 'var(--text-muted)',
    marginBottom: '4px',
  },
  metricValue: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: 'var(--text-primary)',
  },
  filterSection: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
    flexWrap: 'wrap',
    gap: '16px',
  },
  filterGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  filterLabel: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#374151',
  },
  filterSelect: {
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
    backgroundColor: 'var(--surface)',
    color: '#374151',
  },
  transactionsSection: {
    backgroundColor: 'var(--surface)',
    borderRadius: '12px',
    padding: '24px',
    border: '1px solid var(--stroke)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
  },
  sectionTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: 'var(--text-primary)',
    margin: '0 0 20px 0',
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px 20px',
  },
  emptyText: {
    fontSize: '18px',
    fontWeight: '500',
    color: 'var(--text-primary)',
    margin: '0 0 8px 0',
  },
  emptySubtext: {
    fontSize: '14px',
    color: 'var(--text-muted)',
    margin: 0,
  },
  transactionsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  transactionItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '16px',
    padding: '20px',
    border: '1px solid var(--stroke)',
    borderRadius: '12px',
    backgroundColor: 'var(--surface)',
    transition: 'all 0.2s',
  },
  transactionIcon: {
    fontSize: '24px',
    width: '48px',
    height: '48px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '8px',
    backgroundColor: 'var(--n3)',
    flexShrink: 0,
  },
  transactionContent: {
    flex: 1,
    minWidth: 0,
  },
  transactionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '8px',
    flexWrap: 'wrap',
    gap: '8px',
  },
  transactionTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: 'var(--text-primary)',
    margin: 0,
  },
  transactionTags: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  typeTag: {
    padding: '4px 8px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  statusTag: {
    padding: '4px 8px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  transactionDetails: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px',
    flexWrap: 'wrap',
  },
  transactionLocation: {
    fontSize: '14px',
    color: 'var(--text-muted)',
  },
  transactionSeparator: {
    fontSize: '12px',
    color: '#d1d5db',
  },
  transactionDate: {
    fontSize: '14px',
    color: 'var(--text-muted)',
  },
  transactionTime: {
    fontSize: '14px',
    color: 'var(--text-muted)',
  },
  transactionInfo: {
    marginBottom: '8px',
  },
  paymentInfo: {
    fontSize: '14px',
    color: 'var(--text-muted)',
  },
  voucherInfo: {
    fontSize: '14px',
    color: 'var(--text-muted)',
  },
  pointsInfo: {
    fontSize: '14px',
    color: 'var(--text-muted)',
  },
  transactionRight: {
    textAlign: 'right',
    flexShrink: 0,
  },
  transactionAmount: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: 'var(--text-primary)',
    marginBottom: '4px',
  },
  pointsEarned: {
    fontSize: '12px',
    color: '#7c3aed',
    fontWeight: '500',
  },
};

export default TransactionsSection;
