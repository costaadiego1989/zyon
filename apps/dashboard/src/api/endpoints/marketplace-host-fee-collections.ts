import { marketplaceFeeCollectionEndpoints } from "./marketplace-seller-fee-collections.js";

/** Shared transport and money validation, with a separate host purpose/route. */
export function marketplaceHostFeeCollectionEndpoints(base: string, transport: typeof fetch) {
  const endpoints = marketplaceFeeCollectionEndpoints(base, transport, "host");
  return {
    candidatesMarketplaceHostFeeCollections: endpoints.candidatesMarketplaceSellerFeeCollections,
    contextMarketplaceHostFeeCollection: endpoints.contextMarketplaceSellerFeeCollection,
    listMarketplaceHostFeeCollections: endpoints.listMarketplaceSellerFeeCollections,
    getMarketplaceHostFeeCollection: endpoints.getMarketplaceSellerFeeCollection,
    prepareMarketplaceHostFeeCollection: endpoints.prepareMarketplaceSellerFeeCollection,
    executeMarketplaceHostFeeCollection: endpoints.executeMarketplaceSellerFeeCollection,
    reconcileMarketplaceHostFeeCollection: endpoints.reconcileMarketplaceSellerFeeCollection,
    returnMarketplaceHostFeeExcess: endpoints.returnMarketplaceSellerFeeExcess,
    cancelMarketplaceHostFeeCollection: endpoints.cancelMarketplaceSellerFeeCollection,
    closeMarketplaceHostFeeObligation: endpoints.closeMarketplaceSellerFeeObligation,
  };
}
