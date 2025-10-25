export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Goog-FieldMask, X-Goog-Api-Key',
    };

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: corsHeaders,
      });
    }

    // Health check
    if (url.pathname === '/v1/health' && request.method === 'GET') {
      return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() }, 200, corsHeaders);
    }

    // Places API
    if (url.pathname === '/v1/places' && request.method === 'POST') {
      return handlePlaces(request, env, corsHeaders);
    }

    // 404
    return jsonResponse({ error: { code: 'not_found', message: 'route not found' } }, 404, corsHeaders);
  },
};

async function handlePlaces(request, env, corsHeaders) {
  if (!env.GMAPS_API_KEY) {
    return jsonResponse({ error: { code: 'missing_secret', message: 'GMAPS_API_KEY not set' } }, 500, corsHeaders);
  }

  try {
    const body = await request.json();
    const fieldMask = request.headers.get('X-Goog-FieldMask') || 'places.displayName,places.location';
    const acceptLang = request.headers.get('Accept-Language') || 'ja-JP';

    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': env.GMAPS_API_KEY,
        'X-Goog-FieldMask': fieldMask,
        'Accept-Language': acceptLang,
      },
      body: JSON.stringify(body),
    });

    const data = await response.text();
    
    return new Response(data, {
      status: response.status,
      headers: {
        ...corsHeaders,
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (error) {
    return jsonResponse({ error: { code: 'internal_error', message: error.message } }, 500, corsHeaders);
  }
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}