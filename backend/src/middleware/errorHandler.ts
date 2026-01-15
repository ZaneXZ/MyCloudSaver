import { Request, Response } from "express";

interface CustomError extends Error {
  status?: number;
}

export const errorHandler = (err: CustomError, req: Request, res: Response): void => {
  res.status(err.status || 500).json({
    success: false,
    error: err.message || "服务器内部错误",
  });
};
