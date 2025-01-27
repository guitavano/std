import { signal } from "@preact/signals";
import { fetchAPI } from "../../../utils/fetchAPI.ts";
import type {
  OrderForm,
  OrderFormItem,
  SimulationOptions,
  SimulationOrderForm,
} from "../types.ts";

import { AnalyticsItem } from "../../types.ts";
import { mapCategoriesToAnalyticsCategories } from "../../utils/productToAnalyticsItem.ts";

const mapItemCategoriesToAnalyticsCategories = (
  item: OrderFormItem,
): Record<`item_category${number | ""}`, string> => {
  return mapCategoriesToAnalyticsCategories(
    Object.values(item.productCategories),
  );
};

const mapOrderFormItemsToAnalyticsItems = (
  orderForm: Pick<OrderForm, "items" | "marketingData">,
): AnalyticsItem[] => {
  const items = orderForm.items;

  if (!items) {
    return [];
  }

  const coupon = orderForm.marketingData?.coupon ?? undefined;

  return items.map((item, index) => ({
    item_id: item.productId,
    item_name: item.skuName,
    coupon,
    discount: item.price - item.sellingPrice,
    index,
    item_brand: item.additionalInfo.brandName ?? "",
    item_variant: item.id,
    price: item.price,
    quantity: item.quantity,
    ...(mapItemCategoriesToAnalyticsCategories(item)),
  }));
};

const cart = signal<OrderForm | null>(null);
const loading = signal<boolean>(true);

interface AddCouponsToCartOptions {
  text: string;
}

const addCouponsToCart = async ({ text }: AddCouponsToCartOptions) => {
  cart.value = await fetchAPI<OrderForm>(
    `/api/checkout/pub/orderForm/${cart.value!.orderFormId}/coupons`,
    {
      method: "POST",
      body: JSON.stringify({ text }),
      headers: {
        "content-type": "application/json",
      },
    },
  );
};

interface CartInstallmentsOptions {
  paymentSystem: number;
}

const getCartInstallments = async ({
  paymentSystem,
}: CartInstallmentsOptions) => {
  const params = new URLSearchParams({ paymentSystem: `${paymentSystem}` });

  cart.value = await fetchAPI(
    `/api/checkout/pub/orderForm/${
      cart.value!.orderFormId
    }/installments?${params}`,
  );
};

interface IgnoreProfileDataOptions {
  ignoreProfileData: boolean;
}

const ignoreProfileData = async ({
  ignoreProfileData,
}: IgnoreProfileDataOptions) => {
  cart.value = await fetchAPI(
    `/api/checkout/pub/orderForm/${cart.value!.orderFormId}/profile`,
    {
      method: "PATCH",
      body: JSON.stringify({ ignoreProfileData }),
      headers: {
        "content-type": "application/json",
      },
    },
  );
};

interface ChangePriceOptions {
  itemIndex: number;
  price: number;
}

const changePrice = async ({ itemIndex, price }: ChangePriceOptions) => {
  cart.value = await fetchAPI<OrderForm>(
    `/api/checkout/pub/orderForm/${
      cart.value!.orderFormId
    }/items/${itemIndex}/price`,
    {
      method: "PUT",
      body: JSON.stringify({ price }),
      headers: {
        "content-type": "application/json",
      },
    },
  );
};

const getCart = async () => {
  cart.value = await fetchAPI<OrderForm>(`/api/checkout/pub/orderForm`);
};

const removeAllPersonalData = async () => {
  cart.value = await fetchAPI<OrderForm>(
    `/checkout/changeToAnonymousUser/${cart.value!.orderFormId}`,
  );
};

interface UpdateItemsOptions {
  orderItems: Array<{
    quantity: number;
    index: number;
  }>;
  allowedOutdatedData?: Array<"paymentData">;
}

const updateItems = async ({
  orderItems,
  allowedOutdatedData = ["paymentData"],
}: UpdateItemsOptions) => {
  const params = new URLSearchParams();

  if (allowedOutdatedData) {
    for (const it of allowedOutdatedData) {
      params.append("allowedOutdatedData", it);
    }
  }

  cart.value = await fetchAPI<OrderForm>(
    `/api/checkout/pub/orderForm/${
      cart.value!.orderFormId
    }/items/update?${params}`,
    {
      method: "POST",
      body: JSON.stringify({ orderItems }),
      headers: {
        "content-type": "application/json",
      },
    },
  );
};

const simulate = (data: SimulationOptions) =>
  fetchAPI<SimulationOrderForm>(
    `/api/checkout/pub/orderForms/simulation`,
    {
      method: "POST",
      body: JSON.stringify(data),
    },
  );

const removeAllItems = async () => {
  cart.value = await fetchAPI<OrderForm>(
    `/api/checkout/pub/orderForm/${cart.value!.orderFormId}/items/removeAll`,
    { method: "POST" },
  );
};

interface AddItemsOptions {
  orderItems: Array<{
    quantity: number;
    seller: string;
    id: string;
    index?: number;
    price?: number;
  }>;
  allowedOutdatedData?: Array<"paymentData">;
}

const addItems = async ({
  orderItems,
  allowedOutdatedData = ["paymentData"],
}: AddItemsOptions) => {
  const params = new URLSearchParams();

  if (allowedOutdatedData) {
    for (const it of allowedOutdatedData) {
      params.append("allowedOutdatedData", it);
    }
  }

  cart.value = await fetchAPI<OrderForm>(
    `/api/checkout/pub/orderForm/${cart.value!.orderFormId}/items?${params}`,
    {
      method: "POST",
      body: JSON.stringify({ orderItems }),
      headers: {
        "content-type": "application/json",
      },
    },
  );
};

type Middleware = (fn: () => Promise<void>) => Promise<void>;

const withCart: Middleware = async (cb) => {
  if (cart.value === null) {
    throw new Error("Missing cart");
  }

  return await cb();
};

const withLoading: Middleware = async (cb) => {
  try {
    loading.value = true;
    return await cb();
  } finally {
    loading.value = false;
  }
};

let queue = Promise.resolve();
const withPQueue: Middleware = (cb) => {
  queue = queue.then(cb);

  return queue;
};

// Start fetching the cart on client-side only
if (typeof document !== "undefined") {
  const _getCart = () => withPQueue(() => withLoading(getCart));

  _getCart();

  document.addEventListener(
    "visibilitychange",
    () => document.visibilityState === "visible" && _getCart(),
  );
}

const state = {
  loading,
  cart,
  /** @docs https://developers.vtex.com/docs/api-reference/checkout-api#post-/api/checkout/pub/orderForm/-orderFormId-/items/removeAll */
  removeAllItems: () =>
    withPQueue(() => withCart(() => withLoading(removeAllItems))),
  /** @docs https://developers.vtex.com/docs/api-reference/checkout-api#get-/checkout/changeToAnonymousUser/-orderFormId- */
  removeAllPersonalData: () =>
    withPQueue(() => withCart(() => withLoading(removeAllPersonalData))),
  /** @docs https://developers.vtex.com/docs/api-reference/checkout-api#post-/api/checkout/pub/orderForm/-orderFormId-/items/update */
  updateItems: (opts: UpdateItemsOptions) =>
    withPQueue(() => withCart(() => withLoading(() => updateItems(opts)))),
  /** @docs https://developers.vtex.com/docs/api-reference/checkout-api#post-/api/checkout/pub/orderForm/-orderFormId-/items */
  addItems: (opts: AddItemsOptions) =>
    withPQueue(() => withCart(() => withLoading(() => addItems(opts)))),
  /** @docs https://developers.vtex.com/docs/api-reference/checkout-api#put-/api/checkout/pub/orderForm/-orderFormId-/items/-itemIndex-/price */
  changePrice: (opts: ChangePriceOptions) =>
    withPQueue(() => withCart(() => withLoading(() => changePrice(opts)))),
  /** @docs https://developers.vtex.com/docs/api-reference/checkout-api#patch-/api/checkout/pub/orderForm/-orderFormId-/profile */
  ignoreProfileData: (opts: IgnoreProfileDataOptions) =>
    withPQueue(() =>
      withCart(() => withLoading(() => ignoreProfileData(opts)))
    ),
  /** @docs https://developers.vtex.com/docs/api-reference/checkout-api#get-/api/checkout/pub/orderForm/-orderFormId-/installments */
  getCartInstallments: (opts: CartInstallmentsOptions) =>
    withPQueue(() =>
      withCart(() => withLoading(() => getCartInstallments(opts)))
    ),
  /** @docs https://developers.vtex.com/docs/api-reference/checkout-api#post-/api/checkout/pub/orderForm/-orderFormId-/coupons */
  addCouponsToCart: (opts: AddCouponsToCartOptions) =>
    withPQueue(() => withCart(() => withLoading(() => addCouponsToCart(opts)))),
  /** @docs https://developers.vtex.com/docs/api-reference/checkout-api#post-/api/checkout/pub/orderForms/simulation */
  simulate,
  mapItemsToAnalyticsItems: mapOrderFormItemsToAnalyticsItems,
};

export const useCart = () => state;
