const express = require("express");
const router = express.Router();

const listInstances = require("../utils/Docker/ListInstances");
const getInstanceDetails = require("../utils/Docker/InstanceDetails");
const listInstancePorts = require("../utils/Docker/Network");
const deleteInstance = require("../utils/Docker/DeleteInstance");
const purgeAllInstances = require("../utils/Docker/Purge");

router.get("/instances", listInstances);
router.get("/instances/:id", getInstanceDetails);
router.get("/instances/:id/ports", listInstancePorts);
router.delete("/instances/:id/delete", deleteInstance);
router.post("/instances/purge/all", purgeAllInstances);

module.exports = router;
