const { Router } = require("express");
const validate = require("../../middleware/validate");
const authorize = require("../../middleware/authorize");
const { idParams, createBuildingBody } = require("./buildings.schemas");

function createBuildingsRouter(controller) {
  const router = Router();

  router.get("/", controller.list);
  router.get("/:id", validate({ params: idParams }), controller.getById);
  router.get("/:id/rooms", validate({ params: idParams }), controller.listRooms);
  router.post("/", authorize("ADMIN"), validate({ body: createBuildingBody }), controller.create);

  return router;
}

module.exports = { createBuildingsRouter };
