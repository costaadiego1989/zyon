"use client";

import { createContext, useContext } from "react";

export const OneBuyClickPresentation = createContext({ enabled: false, pending: false });
export const useOneBuyClickPresentation = () => useContext(OneBuyClickPresentation);
