import { createContext } from "react";
import type { OpenCheckoutProductDetail } from "./checkout-product-detail";
export const CheckoutProductDetailContext = createContext<OpenCheckoutProductDetail | undefined>(undefined);
