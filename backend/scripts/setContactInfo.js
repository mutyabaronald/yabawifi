const { db } = require("../firebase");

async function setContactInfo() {
  try {
    const contactInfo = {
      phone: "07xxxxxxxxxx", // Replace with actual phone number
      whatsapp: "07xxxxxxxxxx", // Replace with actual WhatsApp number
      email: "ronaldmutyaba256@gmail.com", // Replace with actual email
      updatedAt: new Date().toISOString(),
    };

    await db.collection("settings").doc("super_contact_info").set(contactInfo);
    
    console.log("✅ Contact information set successfully!");
    console.log("Contact Info:", contactInfo);
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Error setting contact information:", error);
    process.exit(1);
  }
}

// Run the script
setContactInfo();

