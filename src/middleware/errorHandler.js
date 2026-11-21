const { AppError } = require("../errors/AppError");

function mapDatabaseError(err) {
  switch (err.code) {
    case "23505": // unique_violation
      return { status: 409, code: "UNIQUE_VIOLATION", message: "Resource already exists" };
    case "23503": // foreign_key_violation
      return {
        status: 409,
        code: "FOREIGN_KEY_VIOLATION",
        message: "Referenced resource does not exist or is still in use"
      };
    case "23514": // check_violation
      return { status: 400, code: "CHECK_VIOLATION", message: "Value violates a database constraint" };
    case "23P01": // exclusion_violation - the last line of defence against double booking
      return err.constraint === "reservations_no_overlap"
        ? { status: 409, code: "ROOM_ALREADY_BOOKED", message: "Room is already booked in this time range" }
        : { status: 409, code: "EXCLUSION_VIOLATION", message: "Resource conflicts with an existing one" };
    case "23505": // unique_violation
      if (err.constraint === "users_email_unique") {
        return { status: 409, code: "EMAIL_TAKEN", message: "Email already registered" };
      }
      return { status: 409, code: "UNIQUE_VIOLATION", message: "Resource already exists" };
    default:
      return null;
  }
}

// Must have 4 parameters - Express recognizes error handlers by fn.length === 4
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId: req.id
      }
    });
  }

  // PostgreSQL constraint violations (SQLSTATE in err.code). The client gets a generic message only:
  // err.detail / err.constraint contain table names, column names and values - they stay in the server logs.
  const dbError = mapDatabaseError(err);
  if (dbError) {
    return res.status(dbError.status).json({
      error: { code: dbError.code, message: dbError.message, requestId: req.id }
    });
  }

  // Thrown by express.json() when the body is not valid JSON
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({
      error: {
        code: "INVALID_JSON",
        message: "Request body is not valid JSON",
        requestId: req.id
      }
    });
  }

  // Unexpected error: full details only in server logs, generic message to the client
  console.error(`[${req.id}]`, err);
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Unexpected error",
      requestId: req.id
    }
  });
}

module.exports = errorHandler;
