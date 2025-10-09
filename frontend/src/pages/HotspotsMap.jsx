import { formatUGX } from "../components/currency";
import React, { useEffect, useState } from "react";
import axios from "axios";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";

// Fix Leaflet default icon paths for bundlers
L.Icon.Default.mergeOptions({
	iconUrl,
	iconRetinaUrl,
	shadowUrl,
});

const greenIcon = new L.Icon({
	iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
	iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
	shadowUrl,
	className: 'marker-green',
});
const greyIcon = new L.Icon({
	iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
	iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
	shadowUrl,
	className: 'marker-grey',
	// color styling can be applied via CSS if needed
});

export default function HotspotsMap() {
	const [map, setMap] = useState(null);
	const [userPos, setUserPos] = useState(null);
	const [hotspots, setHotspots] = useState([]);
	const [sorted, setSorted] = useState([]);
	const [error, setError] = useState("");
	const [markers, setMarkers] = useState([]);
	const [loading, setLoading] = useState(false);
	const [selectedHotspot, setSelectedHotspot] = useState(null);
	const [showModal, setShowModal] = useState(false);
	const [userPhone, setUserPhone] = useState("");

	useEffect(() => {
		// Get user phone from localStorage
		const phone = localStorage.getItem('phone');
		if (phone) {
			setUserPhone(phone);
		}
	}, []);

	useEffect(() => {
		const m = L.map('hotspots-map').setView([0.3476, 32.5825], 13);
		L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			maxZoom: 19,
			attribution: '&copy; OpenStreetMap contributors'
		}).addTo(m);
		setMap(m);
		return () => m.remove();
	}, []);

	const fetchNearbyHotspots = async () => {
		if (!navigator.geolocation) return;
		
		setLoading(true);
		setError("");
		
		try {
			const pos = await new Promise((resolve, reject) => {
				navigator.geolocation.getCurrentPosition(resolve, reject);
			});
			
			const { latitude, longitude } = pos.coords;
			setUserPos({ lat: latitude, lng: longitude });
			
			if (map) {
				map.setView([latitude, longitude], 14);
			}
			
			const res = await axios.get(`/api/hotspots/nearby?lat=${latitude}&lng=${longitude}&radiusKm=5`);
			if (res.data.success) {
				setHotspots(res.data.hotspots || []);
				setSorted(res.data.hotspots || []);
			}
		} catch (e) {
			setError('Failed to load nearby hotspots');
			console.error('Error fetching hotspots:', e);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		if (map && userPos) {
			// Add user location marker
			L.marker([userPos.lat, userPos.lng], { title: 'You are here' }).addTo(map);
		}
	}, [map, userPos]);

	useEffect(() => {
		if (!map) return;
		
		// clear previous markers
		markers.forEach(mk => mk.remove());
		const newMarkers = [];
		
		sorted.forEach(h => {
			const cheapest = [...(h.packages || [])].sort((a,b) => (a.price||0)-(b.price||0))[0];
			const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${h.latitude},${h.longitude}`;
			const popup = `
				<div>
					<b>${h.hotspotName}</b><br/>
					Distance: ${h.distanceKm} km<br/>
					Status: ${h.status}<br/>
					${cheapest ? `Cheapest: ${formatUGX(cheapest.price)}` : 'No packages'}<br/>
					<a href="${dirUrl}" target="_blank" rel="noopener noreferrer">Get Directions</a>
				</div>
			`;
			const icon = h.status === 'online' ? greenIcon : greyIcon;
			const marker = L.marker([h.latitude, h.longitude], { title: h.hotspotName, icon }).addTo(map);
			marker.bindPopup(popup);
			newMarkers.push(marker);
		});
		
		setMarkers(newMarkers);
	}, [sorted, map]);

	// Initial fetch
	useEffect(() => {
		fetchNearbyHotspots();
	}, [map]);

	const applySort = (mode) => {
		let arr = [...hotspots];
		if (mode === 'cheapest') {
			arr.sort((a, b) => {
				const ca = (a.packages||[]).reduce((min,p)=>Math.min(min, p.price||Infinity), Infinity);
				const cb = (b.packages||[]).reduce((min,p)=>Math.min(min, p.price||Infinity), Infinity);
				return (ca === Infinity ? Number.MAX_SAFE_INTEGER : ca) - (cb === Infinity ? Number.MAX_SAFE_INTEGER : cb);
		});
		} else if (mode === 'closest') {
			arr.sort((a, b) => (a.distanceKm||Infinity) - (b.distanceKm||Infinity));
		} else if (mode === 'fastest') {
			arr.sort((a, b) => {
				const fa = Math.max(0, ...((a.packages||[]).map(p => p.speedLimitMbps||0)));
				const fb = Math.max(0, ...((b.packages||[]).map(p => p.speedLimitMbps||0)));
				return fb - fa;
			});
		}
		setSorted(arr);
	};

	// Transform API data to match UI requirements
	const transformHotspotData = (hotspot) => {
		const distance = hotspot.distanceKm ? `${(hotspot.distanceKm * 1000).toFixed(0)}m` : 'Unknown';
		const signal = hotspot.status === 'online' ? 'excellent' : 'poor';
		const signalColor = hotspot.status === 'online' ? '#10b981' : '#ef4444';
		const statusColor = hotspot.status === 'online' ? '#10b981' : '#6b7280';
		
		// Determine available packages
		const packages = [];
		if (hotspot.packages && hotspot.packages.length > 0) {
			hotspot.packages.forEach(pkg => {
				if (pkg.timeLimitMinutes) {
					if (pkg.timeLimitMinutes <= 60) packages.push('hourly');
					else if (pkg.timeLimitMinutes <= 1440) packages.push('daily');
					else if (pkg.timeLimitMinutes <= 10080) packages.push('weekly');
					else packages.push('monthly');
				}
			});
		}
		
		// Remove duplicates
		const uniquePackages = [...new Set(packages)];
		
		return {
			id: hotspot.id,
			name: hotspot.hotspotName,
			distance: distance,
			location: `${hotspot.latitude?.toFixed(4)}, ${hotspot.longitude?.toFixed(4)}`,
			owner: hotspot.ownerId || 'Unknown Owner',
			signal: signal,
			signalColor: signalColor,
			status: hotspot.status || 'offline',
			statusColor: statusColor,
			loyalty: hotspot.loyalty_program_enabled || false,
			packages: uniquePackages.length > 0 ? uniquePackages : ['hourly'],
			originalData: hotspot
		};
	};

	// Smart WiFi range validation
	const isHotspotInRange = (hotspot) => {
		if (!userPos || !hotspot.originalData) return false;
		
		const distanceKm = hotspot.originalData.distanceKm;
		
		// WiFi signal typically reaches 100-300 meters
		// We'll be generous and allow up to 500 meters (0.5 km)
		const maxWiFiRange = 0.5; // 500 meters
		
		return distanceKm <= maxWiFiRange;
	};

	// Check if user has active session at this hotspot
	const checkExistingSession = async (hotspot) => {
		if (!userPhone || !hotspot.originalData) return null;
		
		try {
			const response = await axios.get(`/api/users/${userPhone}/session-status/${hotspot.originalData.id}`);
			return response.data;
		} catch (error) {
			console.error("Error checking session status:", error);
			return null;
		}
	};

	const handleConnect = async (hotspot) => {
		// Check for existing session first
		const sessionStatus = await checkExistingSession(hotspot);
		
		if (sessionStatus && sessionStatus.hasActiveSession) {
			// User has active session - show session info instead of purchase options
			setSelectedHotspot({
				...hotspot,
				existingSession: sessionStatus.session
			});
		} else {
			// No active session - show purchase options
			setSelectedHotspot(hotspot);
		}
		
		setShowModal(true);
	};

	const handleConnectNow = async () => {
		if (!selectedHotspot || !userPhone) return;
		
		// Check if hotspot is in WiFi range
		if (isHotspotInRange(selectedHotspot)) {
			if (selectedHotspot.existingSession) {
				// User has active session - just close modal
				setShowModal(false);
				setSelectedHotspot(null);
				return;
			}
			
			// User is in range and needs to purchase - redirect to packages
			// You can implement navigation to packages page here
			console.log('User in range, redirecting to packages for:', selectedHotspot.name);
			
			// For now, we'll just close the modal
			// You can add navigation logic here:
			// window.location.href = `/packages?hotspotId=${selectedHotspot.originalData.id}`;
			// or use React Router navigation
			
			setShowModal(false);
			setSelectedHotspot(null);
		} else {
			// User is out of range - show warning
			alert(`⚠️ You're too far from ${selectedHotspot.name} to connect.\n\nPlease move closer to the hotspot location to purchase packages and connect.\n\nCurrent distance: ${selectedHotspot.distance}\nRequired: Within 500m`);
		}
	};

	const handleCancel = () => {
		setShowModal(false);
		setSelectedHotspot(null);
	};

	const handleRefresh = () => {
		fetchNearbyHotspots();
	};

	return (
		<div style={{ padding: 16 }}>
			<div style={styles.sectionHeader}>
				<div>
					<h2 style={styles.sectionTitle}>Nearby WiFi Hotspots</h2>
					<p style={styles.sectionSubtitle}>Find and connect to available WiFi networks</p>
				</div>
				<button 
					onClick={handleRefresh}
					style={styles.refreshButton}
					disabled={loading}
				>
					<span style={styles.refreshIcon}>🔄</span>
					{loading ? 'Loading...' : 'Refresh'}
				</button>
			</div>

			{error && <p style={{ color: '#dc2626', marginBottom: '16px' }}>{error}</p>}
			
			<div style={styles.mapContainer}>
				<div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
					<button onClick={() => applySort('cheapest')} style={styles.sortButton}>Cheapest</button>
					<button onClick={() => applySort('closest')} style={styles.sortButton}>Closest</button>
					<button onClick={() => applySort('fastest')} style={styles.sortButton}>Fastest</button>
				</div>
				<div id="hotspots-map" style={{ height: '50vh', width: '100%', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }} />
			</div>

			{/* Hotspot Cards Section */}
			<div style={styles.hotspotCardsSection}>
				<h3 style={styles.cardsSectionTitle}>Available Hotspots</h3>
				
				{loading ? (
					<div style={styles.loadingState}>
						<p>Loading nearby hotspots...</p>
					</div>
				) : sorted.length === 0 ? (
					<div style={styles.emptyState}>
						<p>No hotspots found in your area. Try increasing the search radius or check back later.</p>
					</div>
				) : (
					<div style={styles.hotspotCardsGrid}>
						{sorted.map((hotspot) => {
							const transformedHotspot = transformHotspotData(hotspot);
							const inRange = isHotspotInRange(transformedHotspot);
							
							return (
								<div key={hotspot.id} style={styles.hotspotCard}>
									<div style={styles.hotspotCardLeft}>
										<div style={styles.wifiIcon}>📶</div>
										<div style={styles.distance}>{transformedHotspot.distance}</div>
										{!inRange && (
											<div style={styles.outOfRangeBadge}>Out of Range</div>
										)}
									</div>
									
									<div style={styles.hotspotCardMiddle}>
										<div style={styles.hotspotHeader}>
											<h4 style={styles.hotspotName}>{transformedHotspot.name}</h4>
											<span style={{ ...styles.statusTag, backgroundColor: transformedHotspot.statusColor }}>
												{transformedHotspot.status}
											</span>
										</div>
										
										<div style={styles.hotspotDetails}>
											<p style={styles.hotspotLocation}>📍 {transformedHotspot.location}</p>
											<p style={styles.hotspotOwner}>Owned by {transformedHotspot.owner}</p>
											<div style={styles.signalInfo}>
												<span style={{ ...styles.signalStrength, color: transformedHotspot.signalColor }}>
													Signal: {transformedHotspot.signal}
												</span>
												{transformedHotspot.loyalty && (
													<span style={styles.loyaltyBadge}>
														⭐ Loyalty
													</span>
												)}
											</div>
											
											<div style={styles.packagesSection}>
												<span style={styles.packagesLabel}>Available packages:</span>
												<div style={styles.packageTags}>
													{transformedHotspot.packages.map((pkg, index) => (
														<span key={index} style={styles.packageTag}>{pkg}</span>
													))}
												</div>
											</div>
										</div>
									</div>
									
									<div style={styles.hotspotCardRight}>
										<button 
											onClick={() => handleConnect(transformedHotspot)}
											style={styles.connectButton}
											title={inRange ? "Click to connect" : "Too far to connect - move closer"}
										>
											{inRange ? 'Connect' : 'Too Far'}
										</button>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>

			{/* Hotspot Details Modal */}
			{showModal && selectedHotspot && (
				<div style={styles.modalOverlay}>
					<div style={styles.modal}>
						<div style={styles.modalHeader}>
							<h3 style={styles.modalTitle}>{selectedHotspot.name}</h3>
							<button onClick={handleCancel} style={styles.closeButton}>×</button>
						</div>
						
						<div style={styles.modalContent}>
							{/* Show existing session info if available */}
							{selectedHotspot.existingSession ? (
								<div style={styles.existingSessionSection}>
									<div style={styles.sessionStatusHeader}>
										<span style={styles.sessionStatusIcon}>✅</span>
										<span style={styles.sessionStatusTitle}>Active Session</span>
									</div>
									<div style={styles.sessionDetails}>
										<p style={styles.sessionDetailsParagraph}><strong>Package:</strong> {selectedHotspot.existingSession.packageName}</p>
										<p style={styles.sessionDetailsParagraph}><strong>Time Remaining:</strong> {selectedHotspot.existingSession.timeRemaining} minutes</p>
										<p style={styles.sessionDetailsParagraph}><strong>Data Remaining:</strong> {selectedHotspot.existingSession.dataRemaining} MB</p>
										<p style={styles.sessionDetailsParagraph}><strong>Started:</strong> {new Date(selectedHotspot.existingSession.startTime).toLocaleString()}</p>
									</div>
									<div style={styles.sessionMessage}>
										You're already connected to this hotspot! No need to purchase another package.
									</div>
								</div>
							) : (
								<>
									<div style={styles.modalRow}>
										<span style={styles.modalLabel}>Location:</span>
										<span style={styles.modalValue}>{selectedHotspot.location}</span>
									</div>
									
									<div style={styles.modalRow}>
										<span style={styles.modalLabel}>Owner:</span>
										<span style={styles.modalValue}>{selectedHotspot.owner}</span>
									</div>
									
									<div style={styles.modalRow}>
										<div style={styles.modalColumn}>
											<span style={styles.modalLabel}>Signal Strength:</span>
											<span style={{ ...styles.modalValue, color: selectedHotspot.signalColor }}>
												{selectedHotspot.signal}
											</span>
										</div>
										<div style={styles.modalColumn}>
											<span style={styles.modalLabel}>Distance:</span>
											<span style={styles.modalValue}>{selectedHotspot.distance}</span>
										</div>
									</div>
									
									{selectedHotspot.loyalty && (
										<div style={styles.loyaltySection}>
											<span style={styles.loyaltyIcon}>⭐</span>
											<div style={styles.loyaltyContent}>
												<div style={styles.loyaltyTitle}>Loyalty Program Available</div>
												<div style={styles.loyaltySubtitle}>
													Earn points with every purchase at this hotspot
												</div>
											</div>
										</div>
									)}
									
									{!isHotspotInRange(selectedHotspot) && (
										<div style={styles.warningSection}>
											⚠️ You're too far from this hotspot to connect.
											Please move closer (within 500m) to purchase packages.
										</div>
									)}
								</>
							)}
						</div>
						
						<div style={styles.modalFooter}>
							<button onClick={handleCancel} style={styles.cancelButton}>
								Cancel
							</button>
							{!selectedHotspot.existingSession && (
								<button 
									onClick={handleConnectNow} 
									style={styles.connectNowButton}
									disabled={!isHotspotInRange(selectedHotspot)}
								>
									Connect Now
								</button>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

const styles = {
	sectionHeader: {
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'flex-start',
		marginBottom: '24px',
	},
	sectionTitle: {
		fontSize: '24px',
		fontWeight: 'bold',
		color: '#374151',
		margin: '0 0 8px 0',
	},
	sectionSubtitle: {
		fontSize: '16px',
		color: '#6b7280',
		margin: 0,
	},
	refreshButton: {
		display: 'flex',
		alignItems: 'center',
		gap: '8px',
		padding: '10px 16px',
		backgroundColor: '#2563eb',
		color: '#ffffff',
		border: 'none',
		borderRadius: '8px',
		cursor: 'pointer',
		fontSize: '14px',
		fontWeight: '500',
		transition: 'background-color 0.2s',
	},
	refreshIcon: {
		fontSize: '16px',
	},
	mapContainer: {
		marginBottom: '32px',
	},
	sortButton: {
		padding: '8px 16px',
		backgroundColor: '#f3f4f6',
		border: '1px solid #d1d5db',
		borderRadius: '6px',
		cursor: 'pointer',
		fontSize: '14px',
		color: '#374151',
		transition: 'all 0.2s',
	},
	hotspotCardsSection: {
		marginTop: '32px',
	},
	cardsSectionTitle: {
		fontSize: '20px',
		fontWeight: '600',
		color: '#374151',
		margin: '0 0 20px 0',
	},
	hotspotCardsGrid: {
		display: 'flex',
		flexDirection: 'column',
		gap: '16px',
	},
	hotspotCard: {
		display: 'flex',
		alignItems: 'flex-start',
		gap: '20px',
		padding: '20px',
		backgroundColor: 'var(--surface)',
		borderRadius: '12px',
		boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
		border: '1px solid #e5e7eb',
	},
	hotspotCardLeft: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		gap: '8px',
		minWidth: '60px',
	},
	wifiIcon: {
		fontSize: '32px',
		color: '#2563eb',
	},
	distance: {
		fontSize: '12px',
		color: '#6b7280',
		fontWeight: '500',
	},
	outOfRangeBadge: {
		fontSize: '10px',
		color: '#ef4444',
		fontWeight: '500',
		textAlign: 'center',
	},
	hotspotCardMiddle: {
		flex: 1,
	},
	hotspotHeader: {
		display: 'flex',
		alignItems: 'center',
		gap: '12px',
		marginBottom: '12px',
	},
	hotspotName: {
		fontSize: '18px',
		fontWeight: '600',
		color: '#374151',
		margin: 0,
	},
	statusTag: {
		padding: '4px 12px',
		borderRadius: '20px',
		fontSize: '12px',
		fontWeight: '500',
		color: '#ffffff',
		textTransform: 'capitalize',
	},
	hotspotDetails: {
		display: 'flex',
		flexDirection: 'column',
		gap: '8px',
	},
	hotspotLocation: {
		margin: 0,
		fontSize: '14px',
		color: '#6b7280',
	},
	hotspotOwner: {
		margin: 0,
		fontSize: '14px',
		color: '#6b7280',
	},
	signalInfo: {
		display: 'flex',
		alignItems: 'center',
		gap: '12px',
	},
	signalStrength: {
		fontSize: '14px',
		fontWeight: '500',
	},
	loyaltyBadge: {
		display: 'flex',
		alignItems: 'center',
		gap: '4px',
		fontSize: '12px',
		color: '#f59e0b',
		fontWeight: '500',
	},
	packagesSection: {
		marginTop: '8px',
	},
	packagesLabel: {
		fontSize: '14px',
		color: '#6b7280',
		marginBottom: '8px',
		display: 'block',
	},
	packageTags: {
		display: 'flex',
		flexWrap: 'wrap',
		gap: '8px',
	},
	packageTag: {
		padding: '4px 12px',
		backgroundColor: '#f3f4f6',
		border: '1px solid #d1d5db',
		borderRadius: '20px',
		fontSize: '12px',
		color: '#6b7280',
		fontWeight: '500',
	},
	hotspotCardRight: {
		display: 'flex',
		alignItems: 'center',
	},
	connectButton: {
		padding: '10px 20px',
		backgroundColor: '#2563eb',
		color: '#ffffff',
		border: 'none',
		borderRadius: '8px',
		cursor: 'pointer',
		fontSize: '14px',
		fontWeight: '500',
		whiteSpace: 'nowrap',
		transition: 'background-color 0.2s',
	},
	loadingState: {
		textAlign: 'center',
		padding: '40px 20px',
		color: '#6b7280',
	},
	emptyState: {
		textAlign: 'center',
		padding: '40px 20px',
		color: '#6b7280',
		backgroundColor: '#f9fafb',
		borderRadius: '12px',
		border: '1px solid #e5e7eb',
	},
	// Modal Styles
	modalOverlay: {
		position: 'fixed',
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		backgroundColor: 'rgba(0,0,0,0.5)',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		zIndex: 1000,
	},
	modal: {
		backgroundColor: 'var(--surface)',
		borderRadius: '12px',
		maxWidth: '500px',
		width: '90%',
		boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
		overflow: 'hidden',
	},
	modalHeader: {
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'center',
		padding: '20px 24px',
		borderBottom: '1px solid #e5e7eb',
	},
	modalTitle: {
		fontSize: '20px',
		fontWeight: '600',
		color: '#374151',
		margin: 0,
	},
	closeButton: {
		background: 'none',
		border: 'none',
		fontSize: '24px',
		cursor: 'pointer',
		color: '#6b7280',
		padding: '4px',
		borderRadius: '4px',
		transition: 'background-color 0.2s',
	},
	modalContent: {
		padding: '24px',
	},
	modalRow: {
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'center',
		marginBottom: '16px',
	},
	modalColumn: {
		display: 'flex',
		flexDirection: 'column',
		gap: '4px',
	},
	modalLabel: {
		fontSize: '14px',
		color: '#6b7280',
		fontWeight: '500',
	},
	modalValue: {
		fontSize: '16px',
		fontWeight: '600',
		color: '#374151',
	},
	loyaltySection: {
		display: 'flex',
		alignItems: 'center',
		gap: '12px',
		padding: '16px',
		backgroundColor: '#f3f4f6',
		borderRadius: '8px',
		marginTop: '16px',
	},
	loyaltyIcon: {
		fontSize: '20px',
		color: '#f59e0b',
	},
	loyaltyContent: {
		flex: 1,
	},
	loyaltyTitle: {
		fontSize: '16px',
		fontWeight: '600',
		color: '#8b5cf6',
		marginBottom: '4px',
	},
	loyaltySubtitle: {
		fontSize: '14px',
		color: '#6b7280',
	},
	warningSection: {
		padding: '16px',
		backgroundColor: '#fef3c7',
		border: '1px solid #f59e0b',
		borderRadius: '8px',
		marginTop: '16px',
		color: '#92400e',
		fontSize: '14px',
		textAlign: 'center',
	},
	modalFooter: {
		display: 'flex',
		gap: '12px',
		padding: '20px 24px',
		borderTop: '1px solid #e5e7eb',
		backgroundColor: '#f9fafb',
	},
	cancelButton: {
		flex: 1,
		padding: '12px 20px',
		backgroundColor: '#f3f4f6',
		border: '1px solid #d1d5db',
		borderRadius: '8px',
		cursor: 'pointer',
		fontSize: '14px',
		fontWeight: '500',
		color: '#374151',
		transition: 'all 0.2s',
	},
	connectNowButton: {
		flex: 1,
		padding: '12px 20px',
		backgroundColor: '#2563eb',
		color: '#ffffff',
		border: 'none',
		borderRadius: '8px',
		cursor: 'pointer',
		fontSize: '14px',
		fontWeight: '500',
		transition: 'background-color 0.2s',
	},
	
	// New styles for existing session display
	existingSessionSection: {
		padding: '20px',
		backgroundColor: '#f0f9ff',
		border: '1px solid #0ea5e9',
		borderRadius: '8px',
		marginBottom: '16px',
	},
	sessionStatusHeader: {
		display: 'flex',
		alignItems: 'center',
		gap: '8px',
		marginBottom: '16px',
	},
	sessionStatusIcon: {
		fontSize: '24px',
	},
	sessionStatusTitle: {
		fontSize: '18px',
		fontWeight: '600',
		color: '#0ea5e9',
	},
	sessionDetails: {
		marginBottom: '16px',
	},
	sessionDetailsParagraph: {
		margin: '8px 0',
		fontSize: '14px',
		color: '#374151',
	},
	sessionMessage: {
		padding: '12px',
		backgroundColor: '#ecfdf5',
		border: '1px solid #10b981',
		borderRadius: '6px',
		color: '#065f46',
		fontSize: '14px',
		textAlign: 'center',
		fontWeight: '500',
	},
};
