import type {
  BreadcrumbList,
  Filter,
  Navbar,
  Offer,
  Product,
  ProductDetailsPage,
  PropertyValue,
  UnitPriceSpecification,
} from "./../types.ts";

import { slugify } from "./utils/slugify.ts";
import type {
  Category,
  Facet as FacetVTEX,
  FacetValueBoolean,
  FacetValueRange,
  Item as SkuVTEX,
  LegacyFacet,
  LegacyItem as LegacySkuVTEX,
  LegacyProduct as LegacyProductVTEX,
  Product as ProductVTEX,
  Seller as SellerVTEX,
} from "./types.ts";

const isLegacySku = (
  sku: LegacySkuVTEX | SkuVTEX,
): sku is LegacySkuVTEX =>
  typeof (sku as LegacySkuVTEX).variations?.[0] === "string";

const isLegacyProduct = (
  product: ProductVTEX | LegacyProductVTEX,
): product is LegacyProductVTEX => product.origin !== "intelligent-search";

const getCanonicalURL = (url: URL, { linkText }: { linkText: string }) =>
  new URL(`/${linkText}/p`, url.origin);

const getProductURL = (
  url: URL,
  product: { linkText: string },
  skuId?: string,
) => {
  const canonicalUrl = getCanonicalURL(url, product);

  if (skuId) {
    canonicalUrl.searchParams.set("skuId", skuId);
  }

  return canonicalUrl;
};

const nonEmptyArray = <T>(array: T[] | null | undefined) =>
  Array.isArray(array) && array.length > 0 ? array : null;

const DEFAULT_IMAGE = {
  imageText: "image",
  imageUrl:
    "https://storecomponents.vtexassets.com/assets/faststore/images/image___117a6d3e229a96ad0e0d0876352566e2.svg",
};

interface ProductOptions {
  url: URL;
  /** Price coded currency, e.g.: USD, BRL */
  priceCurrency: string;
}

export const toProductPage = (
  product: ProductVTEX | LegacyProductVTEX,
  maybeSkuId: string | undefined,
  options: ProductOptions,
): ProductDetailsPage => {
  const skuId = maybeSkuId ?? product.items[0]?.itemId;
  const sku = product.items.find((item) => item.itemId === skuId);

  if (!sku) {
    throw new Error(`Missing sku ${skuId} on product ${product.productName}`);
  }

  return {
    "@type": "ProductDetailsPage",
    breadcrumbList: toBreadcrumbList(product, options),
    product: toProduct(product, sku, 0, options),
  };
};

export const inStock = (offer: Offer) =>
  offer.availability === "https://schema.org/InStock";

// Smallest Available Spot Price First
export const bestOfferFirst = (a: Offer, b: Offer) => {
  if (inStock(a) && !inStock(b)) {
    return -1;
  }

  if (!inStock(a) && inStock(b)) {
    return 1;
  }

  return a.price - b.price;
};

const getHighPriceIndex = (offers: Offer[]) => {
  let it = offers.length - 1;
  for (; it > 0 && !inStock(offers[it]); it--);
  return it;
};

const splitCategory = (firstCategory: string) =>
  firstCategory.split("/").filter(Boolean);

const toAdditionalPropertyCategories = <
  P extends LegacyProductVTEX | ProductVTEX,
>(product: P): Product["additionalProperty"] => {
  const categories = splitCategory(product.categories[0]);
  const categoryIds = splitCategory(product.categoriesIds[0]);

  return [
    ...categories.map((category) => ({
      "@type": "PropertyValue" as const,
      name: "category",
      value: category,
    })),
    ...categoryIds.map((categoryId) => ({
      "@type": "PropertyValue" as const,
      name: "categoryId",
      value: categoryId,
    })),
  ];
};

export const toProduct = <P extends LegacyProductVTEX | ProductVTEX>(
  product: P,
  sku: P["items"][number],
  level = 0, // prevent inifinte loop while self referencing the product
  options: ProductOptions,
): Product => {
  const { url, priceCurrency } = options;
  const {
    brand,
    productId,
    productReference,
    description,
    releaseDate,
    items,
  } = product;
  const { name, ean, itemId: skuId } = sku;

  const groupAdditionalProperty = isLegacyProduct(product)
    ? legacyToProductGroupAdditionalProperties(product)
    : toProductGroupAdditionalProperties(product);
  const specificationsAdditionalProperty = isLegacySku(sku)
    ? toAdditionalPropertiesLegacy(sku)
    : toAdditionalProperties(sku);
  const images = nonEmptyArray(sku.images) ?? [DEFAULT_IMAGE];
  const offers = sku.sellers.map(toOffer).sort(bestOfferFirst);
  const hasVariant = level < 1 &&
    items.map((sku) => toProduct(product, sku, 1, options));
  const highPriceIndex = getHighPriceIndex(offers);
  const lowPriceIndex = 0;

  // From schema.org: A category for the item. Greater signs or slashes can be used to informally indicate a category hierarchy
  const categoriesString = splitCategory(product.categories[0]).join(">");
  const categoryAdditionalProperties = toAdditionalPropertyCategories(product);

  const additionalProperty = specificationsAdditionalProperty.concat(
    categoryAdditionalProperties ?? [],
  );
  return {
    "@type": "Product",
    category: categoriesString,
    productID: skuId,
    url: getProductURL(url, product, sku.itemId).href,
    name,
    description,
    brand,
    sku: skuId,
    gtin: ean,
    releaseDate,
    additionalProperty,
    isVariantOf: {
      "@type": "ProductGroup",
      productGroupID: productId,
      hasVariant: hasVariant || [],
      url: getProductURL(url, product, sku.itemId).href,
      name: product.productName,
      additionalProperty: groupAdditionalProperty,
      model: productReference,
    },
    image: images.map(({ imageUrl, imageText }) => ({
      "@type": "ImageObject" as const,
      alternateName: imageText ?? "",
      url: imageUrl,
    })),
    offers: offers.length > 0
      ? {
        "@type": "AggregateOffer",
        priceCurrency,
        highPrice: offers[highPriceIndex]?.price ?? null,
        lowPrice: offers[lowPriceIndex]?.price ?? null,
        offerCount: offers.length,
        offers,
      }
      : undefined,
  };
};

const toBreadcrumbList = (
  product: ProductVTEX,
  { url }: ProductOptions,
): BreadcrumbList => {
  const { categories, productName } = product;

  return {
    "@type": "BreadcrumbList",
    itemListElement: [
      ...categories.reverse().map((categoryPath, index) => {
        const splitted = categoryPath.split("/").filter(Boolean);
        const name = splitted[splitted.length - 1];
        const item = splitted.map(slugify).join("/");

        return {
          "@type": "ListItem" as const,
          name,
          item: new URL(`/${item}`, url.origin).href,
          position: index + 1,
        };
      }),
      {
        "@type": "ListItem",
        name: productName,
        item: getCanonicalURL(url, product).href,
        position: categories.length + 1,
      },
    ],
    numberOfItems: categories.length + 1,
  };
};

const legacyToProductGroupAdditionalProperties = (
  product: LegacyProductVTEX,
) =>
  product.allSpecifications?.flatMap((name) => {
    const values = (product as unknown as Record<string, string[]>)[name];

    return values.map((value) =>
      ({
        "@type": "PropertyValue",
        name,
        value,
        valueReference: "SPECIFICATION",
      }) as const
    );
  }) ?? [];

const toProductGroupAdditionalProperties = ({ properties = [] }: ProductVTEX) =>
  properties.flatMap(({ name, values }) =>
    values.map((value) =>
      ({
        "@type": "PropertyValue",
        name,
        value,
        valueReference: "PROPERTY" as string,
      }) as const
    )
  );

const toAdditionalProperties = (
  sku: SkuVTEX,
): PropertyValue[] =>
  sku.variations?.flatMap(({ name, values }) =>
    values.map((value) =>
      ({
        "@type": "PropertyValue",
        name,
        value,
        valueReference: "SPECIFICATION",
      }) as const
    )
  ) ?? [];

const toAdditionalPropertiesLegacy = (sku: LegacySkuVTEX): PropertyValue[] =>
  sku.variations?.flatMap((variation) =>
    sku[variation].map((value) =>
      ({
        "@type": "PropertyValue",
        name: variation,
        value,
        valueReference: "SPECIFICATION",
      }) as const
    )
  ) ?? [];

const toOffer = ({
  commertialOffer: offer,
  sellerId,
}: SellerVTEX): Offer => ({
  "@type": "Offer",
  price: offer.spotPrice ?? offer.Price,
  seller: sellerId,
  priceValidUntil: offer.PriceValidUntil,
  inventoryLevel: { value: offer.AvailableQuantity },
  priceSpecification: [
    {
      "@type": "UnitPriceSpecification",
      priceType: "https://schema.org/ListPrice",
      price: offer.ListPrice,
    },
    {
      "@type": "UnitPriceSpecification",
      priceType: "https://schema.org/SalePrice",
      price: offer.Price,
    },
    ...offer.Installments.map((installment): UnitPriceSpecification => ({
      "@type": "UnitPriceSpecification",
      priceType: "https://schema.org/SalePrice",
      priceComponentType: "https://schema.org/Installment",
      name: installment.PaymentSystemName,
      description: installment.Name,
      billingDuration: installment.NumberOfInstallments,
      billingIncrement: installment.Value,
      price: installment.TotalValuePlusInterestRate,
    })),
  ],
  availability: offer.AvailableQuantity > 0
    ? "https://schema.org/InStock"
    : "https://schema.org/OutOfStock",
});

const unselect = (facet: LegacyFacet, url: URL, map: string) => {
  const mapSegments = map.split(",");

  // Do not allow removing root facet to avoid going back to home page
  if (mapSegments.length === 1) {
    return `${url.pathname}${url.search}`;
  }

  const index = mapSegments.findIndex((segment) => segment === facet.Map);
  mapSegments.splice(index, index > -1 ? 1 : 0);
  const newUrl = new URL(
    url.pathname.replace(`/${facet.Value}`, ""),
    url.origin,
  );
  newUrl.search = url.search;
  if (mapSegments.length > 0) {
    newUrl.searchParams.set("map", mapSegments.join(","));
  }

  return `${newUrl.pathname}${newUrl.search}`;
};

export const legacyFacetToFilter = (
  name: string,
  facets: LegacyFacet[],
  url: URL,
  map: string,
): Filter | null => {
  const mapSegments = new Set(map.split(","));
  const pathSegments = new Set(
    url.pathname.split("/").slice(0, mapSegments.size + 1),
  );

  return {
    "@type": "FilterToggle",
    quantity: facets.length,
    label: name,
    key: name,
    values: facets.map((facet) => {
      const selected = mapSegments.has(facet.Map) &&
        pathSegments.has(facet.Value);
      const href = selected ? unselect(facet, url, map) : facet.LinkEncoded;

      return ({
        value: facet.Value,
        quantity: facet.Quantity,
        url: href,
        label: facet.Name,
        selected,
      });
    }),
  };
};

export const filtersToSearchParams = (
  selectedFacets: { key: string; value: string }[],
) => {
  const searchParams = new URLSearchParams();

  for (const { key, value } of selectedFacets) {
    searchParams.append(`filter.${key}`, value);
  }

  return searchParams;
};

export const filtersFromSearchParams = (params: URLSearchParams) => {
  const selectedFacets: { key: string; value: string }[] = [];

  params.forEach((value, name) => {
    const [filter, key] = name.split(".");

    if (filter === "filter" && typeof key === "string") {
      selectedFacets.push({ key, value });
    }
  });

  return selectedFacets;
};

export const toFilter = (
  facet: FacetVTEX,
  selectedFacets: { key: string; value: string }[],
): Filter | null => {
  if (facet.hidden) {
    return null;
  }

  if (facet.type === "PRICERANGE") {
    return {
      "@type": "FilterRange",
      label: facet.name,
      key: facet.key,
      values: {
        min: (facet.values as FacetValueRange[]).reduce(
          (acc, curr) => acc > curr.range.from ? curr.range.from : acc,
          Infinity,
        ),
        max: (facet.values as FacetValueRange[]).reduce(
          (acc, curr) => acc < curr.range.to ? curr.range.to : acc,
          0,
        ),
      },
    };
  }

  return {
    "@type": "FilterToggle",
    key: facet.key,
    label: facet.name,
    quantity: facet.quantity,
    values: (facet.values as FacetValueBoolean[]).map((
      { quantity, name, value, selected },
    ) => {
      const newFacet = { key: facet.key, value };
      const filters = selected
        ? selectedFacets.filter((facet) =>
          facet.key !== newFacet.key && facet.value !== newFacet.value
        )
        : [...selectedFacets, newFacet];

      return {
        value,
        quantity,
        selected,
        url: `?${filtersToSearchParams(filters).toString()}`,
        label: name,
      };
    }),
  };
};

function nodeToNavbar(node: Category): Navbar {
  const url = new URL(node.url, "https://example.com");

  return {
    href: `${url.pathname}${url.search}`,
    label: node.name,
    children: node.children.map(nodeToNavbar),
  };
}

export const categoryTreeToNavbar = (tree: Category[]): Navbar[] =>
  tree.map(nodeToNavbar);
