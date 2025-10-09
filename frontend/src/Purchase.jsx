import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import MTNPaymentForm from "./components/MTNPaymentForm";

export default function Purchase() {
  const location = useLocation();
  const [ownerId, setOwnerId] = useState("");
  const [routerId, setRouterId] = useState("");
  const [packages, setPackages] = useState([]);
  const [logo, setLogo] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [ownerWhatsapp, setOwnerWhatsapp] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlOwnerId = params.get("ownerId") || "";
    const urlRouterId = params.get("routerId") || "";
    if (urlOwnerId) setOwnerId(urlOwnerId);
    if (urlRouterId) setRouterId(urlRouterId);
  }, [location.search]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        if (routerId) {
          const pkgRes = await fetch(`/api/routers/${encodeURIComponent(routerId)}/packages`);
          if (pkgRes.ok) {
            const json = await pkgRes.json();
            setOwnerId(json.ownerId);
            setPackages(json.packages || []);
          }
          const brandRes = await fetch(`/api/routers/${encodeURIComponent(routerId)}/portal-branding`);
          if (brandRes.ok) {
            const brand = await brandRes.json();
            setLogo(brand.logoUrl || "");
            setOwnerName(brand.ownerName || "");
          }
          return;
        }
        if (ownerId) {
          const [pkgRes, ownerRes] = await Promise.all([
            fetch(`/api/packages/${encodeURIComponent(ownerId)}`),
            fetch(`/api/owners/logo/${encodeURIComponent(ownerId)}`),
          ]);
          if (pkgRes.ok) setPackages(await pkgRes.json());
          if (ownerRes.ok) {
            const o = await ownerRes.json();
            setLogo(o.logoUrl || "");
            setOwnerName(o.ownerName || "");
            setOwnerPhone(o.ownerPhone || "");
            setOwnerWhatsapp(o.ownerWhatsapp || "");
          }
        }
      } catch (e) {
        console.error("Purchase fetch error:", e);
      }
    };
    fetchData();
  }, [ownerId, routerId]);

  return (
    <div style={{ maxWidth: 600, margin: "20px auto", textAlign: "center" }}>
      {logo && (
        <img src={logo} alt="Owner Logo" style={{ height: 60, objectFit: "contain" }} />
      )}
      <h2>{ownerName ? `${ownerName} – Buy Access` : "Buy WiFi Access"}</h2>
      <MTNPaymentForm ownerId={ownerId} packages={packages} ownerPhone={ownerPhone} ownerWhatsapp={ownerWhatsapp} />
    </div>
  );
}


