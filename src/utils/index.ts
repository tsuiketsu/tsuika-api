import type { Context } from "hono";
import { DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT } from "../constants";
import type { AuthType } from "../lib/create-app";
import { type OrderDirection, orderDirections } from "../types";
import { ApiError } from "./api-error";

export const getUserId = async (c: Context<AuthType>): Promise<string> => {
  const userId = c.get("user")?.id;

  if (!userId) {
    throw new ApiError(401, "Unauthorized access detected");
  }

  return userId;
};

export const getPagination = (
  query: Record<string, string | undefined>,
  defaultLimit = DEFAULT_QUERY_LIMIT,
  maxLimit = MAX_QUERY_LIMIT,
) => {
  const rawLimit = Number.parseInt(query.limit || `${defaultLimit}`);
  const page = Math.max(Number.parseInt(query.page || "1"), 1);

  const safeLimit = Math.min(Math.max(rawLimit, 1), maxLimit);
  const offset = (page - 1) * safeLimit;

  return { offset, limit: safeLimit, page };
};

export const getOrderDirection = (
  query: Record<string, string | undefined>,
): OrderDirection => {
  const orderBy = query?.orderBy as OrderDirection;

  if (orderBy && !orderDirections.includes(orderBy)) {
    throw new ApiError(400, "Invalid order direction");
  }

  return orderBy;
};
