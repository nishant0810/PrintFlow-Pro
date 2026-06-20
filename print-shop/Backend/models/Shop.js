const mongoose = require("mongoose");

const shopSchema = new mongoose.Schema({
    name: String,
    address: String,
    location: {
        lat: Number,
        lng: Number
    },
    baseRate: { type: Number, default: 10 },
    isActive: { type: Boolean, default: true }
});

module.exports = mongoose.model("Shop", shopSchema);