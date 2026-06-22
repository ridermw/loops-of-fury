export function normalizeSku(input) {
  if (typeof input !== 'string') {
    throw new TypeError('SKU must be a string');
  }

  return input.trim().toUpperCase();
}

export function reserveStock(inventory, request) {
  const sku = normalizeSku(request.sku);
  const quantity = request.quantity;

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError('Reservation quantity must be a positive integer');
  }

  const item = inventory[sku];
  if (!item) {
    return {
      status: 'backordered',
      sku,
      requested: quantity,
      reserved: 0,
      remaining: 0
    };
  }

  if (item.available < quantity) {
    item.available = 0;
    return {
      status: 'backordered',
      sku,
      requested: quantity,
      reserved: item.available,
      remaining: 0
    };
  }

  item.available -= quantity;
  item.reservations.push({
    reservationId: request.reservationId,
    quantity
  });

  return {
    status: 'reserved',
    sku,
    requested: quantity,
    reserved: quantity,
    remaining: item.available
  };
}

export function summarizeBackorders(results) {
  return results
    .filter((result) => result.status === 'backordered')
    .map((result) => ({
      sku: result.sku,
      shortage: result.requested
    }));
}

