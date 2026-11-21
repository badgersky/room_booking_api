// Simulated notification: when an ADMIN cancels somebody else's reservation, the owner gets a "message"
// (only logged to the console - no real e-mail is sent).
function registerNotificationListeners(eventBus, usersRepository) {
  eventBus.subscribe("reservation.cancelled", async event => {
    const { reservationId, userId, cancelledBy } = event.payload;
    if (cancelledBy === userId) return;

    const canceller = await usersRepository.findById(cancelledBy);
    if (!canceller || canceller.role !== "ADMIN") return;

    const owner = await usersRepository.findById(userId);
    if (!owner) return;

    console.log(
      `[notification] to: ${owner.email} - your reservation #${reservationId} was cancelled by an administrator`
    );
  });
}

module.exports = { registerNotificationListeners };
