import { createClient } from 'npm:@supabase/supabase-js@2';

// Health check v1.2 - manual auth bypass for public health endpoint
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  // CORS headers for cron-job.org
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers, status: 204 });
  }

  // Only allow GET
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      headers,
      status: 405,
    });
  }

  // MANUAL AUTH BYPASS: Allow unauthenticated requests for health endpoint
  // (config.toml verify_jwt=false may not work in all CLI versions)
  const authHeader = req.headers.get('Authorization');
  const isServiceRole = authHeader?.startsWith('Bearer ') && authHeader.includes('service_role');
  
  // For health check, we allow both authenticated and unauthenticated requests
  // The function itself uses service role key internally for DB access

  try {
    // Quick health check: verify DB connectivity
    const { error } = await supabase.from('config').select('key').limit(1);
    
    if (error) {
      console.error('Health check DB error:', error.message);
      return new Response(JSON.stringify({ 
        ok: false, 
        error: 'Database connection failed',
        timestamp: new Date().toISOString() 
      }), {
        headers,
        status: 503,
      });
    }

    return new Response(JSON.stringify({ 
      ok: true, 
      timestamp: new Date().toISOString() 
    }), {
      headers,
      status: 200,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('Health check error:', errorMessage);
    
    return new Response(JSON.stringify({ 
      ok: false, 
      error: 'Health check failed',
      timestamp: new Date().toISOString() 
    }), {
      headers,
      status: 503,
    });
  }
});