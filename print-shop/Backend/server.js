const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const http = require("http"); 
const { Server } = require("socket.io"); 
const PrintJob = require("./models/PrintJob");
const Razorpay = require('razorpay');

const fs = require('fs');
const path = require('path');


const razorpay = new Razorpay({
    key_id: 'rzp_test_SiHr3h1kvKU7O3',
    key_secret: 'VjOeI372jnd6OD9sNJa7YFp5',
});

const app = express();
const server = http.createServer(app); 
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const SHOPS = [
    { id: "ganpat", name: "Ganpat Shop", address: "Behind Sai hostel", secret: "GANPAT2026" },
    { id: "tuck", name: "Tuck Shop", address: "University Gate 1", secret: "TUCKSHOP2026" },
    { id: "scribble", name: "Scribble", address: "Near CSIT", secret: "SCRIBBLE2026" },
    { id: "csit", name: "CSIT Prints", address: "Near Mandir", secret: "CSIT2026" },
    { id: "bisht", name: "Bisht Store", address: "Infront of Sai hostel", secret: "BISHT2026" },
    { id: "root", name: "Network Master", address: "Central Command", secret: "PRINT-FLOW-MASTER" }
];

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, "uploads/"),
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const upload = multer({ storage });

// Socket Connection Logic
io.on("connection", (socket) => {
    console.log("A user connected to the hub");
});

app.get("/shops", async (req, res) => {
    const enrichedShops = await Promise.all(SHOPS.map(async (shop) => {
        const activeCount = await PrintJob.countDocuments({ shopId: shop.id, status: "pending" });
        return { ...shop, activeJobs: activeCount };
    }));
    res.json(enrichedShops);
});

app.get("/print", async (req, res) => {
    const adminKey = req.headers['x-admin-key'];
    const authorizedShop = SHOPS.find(s => s.secret === adminKey);
    if (!authorizedShop) return res.status(403).json({ error: "INVALID_KEY" });
    let query = authorizedShop.id !== "root" ? { shopId: authorizedShop.id } : {};
    try {
        const jobs = await PrintJob.find(query).sort({ createdAt: -1 });
        res.json({ jobs, shopName: authorizedShop.name });
    } catch (err) { res.status(500).json({ error: "DB_ERROR" }); }
});

app.get("/system-health", (req, res) => {
    const uploadsDir = path.join(__dirname, 'uploads');
    
    // Read the directory and calculate total size of all files
    fs.readdir(uploadsDir, (err, files) => {
        if (err) return res.status(500).json({ error: "Cannot read storage" });

        let totalSize = 0;
        files.forEach(file => {
            const stats = fs.statSync(path.join(uploadsDir, file));
            totalSize += stats.size;
        });

        // assuming Disk Quota is 50MB (50 * 1024 * 1024 bytes)
        const quota = 50 * 1024 * 1024; 
        const usedPercent = (totalSize / quota) * 100;
        const remainingPercent = Math.max(0, 100 - usedPercent);

        res.json({
            inkRemaining: remainingPercent.toFixed(2),
            bytesUsed: totalSize,
            filesCount: files.length
        });
    });
});

app.post("/print", upload.single("file"), async (req, res) => {
    try {
        // CRASH PROTECTION: Check if file exists
        if (!req.file) {
            console.log("❌ UPLOAD_FAILED: No file received in the request.");
            return res.status(400).json({ error: "FILE_REQUIRED" });
        }

        const { shopId, copies, paperType, colorMode } = req.body;

        // DATA VALIDATION: Ensure all fields are present
        if (!shopId || !paperType || !colorMode) {
            return res.status(400).json({ error: "MISSING_SPECIFICATIONS" });
        }

        const multipliers = { 
            paper: { standard: 1, matte: 1.5, glossy: 2.5, archival: 5 }, 
            color: { bw: 1, grayscale: 1.2, color: 3 } 
        };

        // Calculate Price
        const price = (10.00 * multipliers.paper[paperType] * multipliers.color[colorMode]) * Number(copies || 1);

        const job = new PrintJob({
            printID: "PRT-" + Math.floor(1000 + Math.random() * 9000),
            shopId, 
            fileName: req.file.filename, // Safe to access now because of the check above
            copies: Number(copies || 1), 
            paperType, 
            colorMode, 
            price, 
            status: "pending"
        });

        await job.save();
        console.log(`✅ JOB_CREATED: ${job.printID} for ${shopId}`);
        res.json(job);

    } catch (err) {
        console.error("🔥 SERVER_ERROR:", err);
        res.status(500).json({ error: "INTERNAL_TRANSMISSION_ERROR" });
    }
});

app.post("/create-order", async (req, res) => {
    const { amount } = req.body; // Amount in Rupees
    try {
        const options = {
            amount: amount * 100, // Razorpay works in Paisa (100 = 1 Rupee)
            currency: "INR",
            receipt: "receipt_" + Math.random().toString(36).substring(7),
        };
        const order = await razorpay.orders.create(options);
        res.json(order);
    } catch (err) {
        res.status(500).send(err);
    }
});

app.patch("/print/:id", async (req, res) => {
    const adminKey = req.headers['x-admin-key'];
    const user = SHOPS.find(s => s.secret === adminKey);
    if (!user) return res.status(403).json({ error: "AUTH_FAILED" });

    try {
        const job = await PrintJob.findById(req.params.id);
        if (!job) return res.status(404).send("JOB_NOT_FOUND");

        if (user.id === "root" || job.shopId === user.id) {
            job.status = "printed";
            await job.save();

            // SOCKET BROADCAST: Notify all clients
            io.emit("statusUpdate", { 
                printID: job.printID, 
                status: "READY",
                shop: job.shopId 
            });

            res.send("SUCCESS: Ink Released");
        } else {
            res.status(403).json({ error: "NOT_YOUR_NODE" });
        }
    } catch (err) { res.status(500).send("SERVER_ERROR"); }
});

mongoose.connect("mongodb://127.0.0.1:27017/printDB").then(() => console.log("Network Live"));
// Change to server.listen
server.listen(5000, () => console.log("Server running on port 5000"));