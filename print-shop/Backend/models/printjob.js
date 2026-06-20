const mongoose = require("mongoose");

const printJobSchema = new mongoose.Schema({
    printID: String,
    shopId: String,
    fileName: String,
    copies: { type: Number, default: 1 },
    paperType: { 
        type: String, 
        enum: ['standard', 'glossy', 'matte', 'archival'], 
        default: 'standard' 
    },
    colorMode: { 
        type: String, 
        enum: ['bw', 'color', 'grayscale'], 
        default: 'bw' 
    },
    status: { type: String, default: "pending" },
    price: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("PrintJob", printJobSchema);