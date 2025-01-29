const axios = require("axios");
const { getDistance } = require("geolib");

// ✅ Function to fetch coordinates from the pincode
async function getCoordinatesFromPincode(pincode) {
  const url = `https://nominatim.openstreetmap.org/search?postalcode=${pincode}&country=India&format=json`;

  try {
    const response = await axios.get(url);
    const data = response.data;

    if (data.length > 0) {
      const { lat, lon } = data[0];
      return { latitude: parseFloat(lat), longitude: parseFloat(lon) };
    }

    throw new Error("No coordinates found for the given pincode.");
  } catch (error) {
    console.error("Error fetching coordinates:", error);
    return null;
  }
}

// ✅ Function to find the nearest warehouse
function findNearestLocation(userCoordinates, warehouseCoordinates) {
  let nearestLocation = null;
  let minDistance = Infinity;

  Object.entries(warehouseCoordinates).forEach(([pincode, coords]) => {
    const distance = getDistance(userCoordinates, coords);
    if (distance < minDistance) {
      minDistance = distance;
      nearestLocation = { pincode, coords };
    }

  });

  return nearestLocation;
}

// ✅ Main Netlify handler function
exports.handler = async (event) => {
  // ✅ Handle CORS preflight request (OPTIONS)
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
  }

  // ✅ Parse query parameters
  const { pincode, productId } = event.queryStringParameters || {};

  if (!pincode || !productId) {
    return {
      statusCode: 400,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Missing pincode or productId" }),
    };
  }

  // ✅ Shopify API Configuration
  const SHOPIFY_API_URL = "https://ruhe-solution.myshopify.com/admin/api/2023-01/graphql.json";
  const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;

  const warehouseCoordinates = {
    "382213": { latitude: 23.0225, longitude: 72.5714 }, // Ahmedabad
    "110042": { latitude: 28.7041, longitude: 77.1025 }, // Delhi
    "562123": { latitude: 12.9716, longitude: 77.5946 }, // Bangalore
    "131028": { latitude: 28.9876, longitude: 77.1136 }, // Kundli
  };

  const warehouseLocationMap = {
    "Ahmedabad Warehouse": "382213",
    "Delhi Warehouse": "110042",
    "Emiza Blr Warehouse": "562123",
    "Kundli Warehouse": "131028",
  };

   
  const query = `
    query getProductById($productId: ID!) {
      product(id: $productId) {
        id
        title
        variants(first: 10) {
          edges {
            node {
              id
              title
              inventoryItem {
                inventoryLevels(first: 10) {
                  edges {
                    node {
                      location {
                        id
                        name
                      }
                      quantities(names: "available") {
                        quantity
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  // ✅ Calculate estimated delivery date (today + 6 days)
  const today = new Date();
  today.setDate(today.getDate() + 5);
  const estimatedDeliveryDate = today.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  try {
    // ✅ Fetch user location coordinates
    const userCoordinates = await getCoordinatesFromPincode(pincode);
    if (!userCoordinates) {
      return {
        statusCode: 404,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Invalid pincode. No coordinates found." }),
      };
    }

    // ✅ Fetch product inventory from Shopify
    const shopifyResponse = await axios.post(
      SHOPIFY_API_URL,
      { query, variables: { productId } },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_API_KEY,
        },
      }
    );

    if (!shopifyResponse.data || !shopifyResponse.data.data.product) {
      return {
        statusCode: 404,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Product not found in Shopify" }),
      };
    }

    // ✅ Extract inventory levels
    const product = shopifyResponse.data.data.product;
    const inventoryLevels = product.variants.edges.flatMap((variant) =>
      variant.node.inventoryItem.inventoryLevels.edges.map((level) => ({
        locationName: level.node.location.name,
        quantity: level.node.quantities[0]?.quantity || 0,
      }))
    );

    // ✅ Find the nearest warehouse
    const nearestLocation = findNearestLocation(userCoordinates, warehouseCoordinates);

    if (!nearestLocation) {
      return {
        statusCode: 404,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "No warehouse found near the provided pincode." }),
      };
    }

    // ✅ Check if the product is available in the nearest warehouse
    const availableInventory = inventoryLevels.find(
      (level) => warehouseLocationMap[level.locationName] === nearestLocation.pincode && level.quantity > 0
    );

    if (availableInventory) {
      return {
        statusCode: 200,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          message: `Estimate Delivery ${estimatedDeliveryDate},  <br> Dispatch from ${availableInventory.locationName}.`,
        }),
      };
    }

    // ✅ Check fallback inventory (product available at any other warehouse)
    const fallbackInventory = inventoryLevels.find((level) => level.quantity > 0);

    if (fallbackInventory) {
      return {
        statusCode: 200,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          message: `Estimate Delivery ${estimatedDeliveryDate}, <br> Dispatch from ${fallbackInventory.locationName}.`,
        }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Product is out of stock at all locations." }),
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Server error" }),
    };
  }
};
