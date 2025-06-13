
export const config = { 
  runtime: 'edge',
  regions: ['hkg1', 'icn1'] 
};

export default function(request) {
  const url = new URL(request.url);
  
  if (request.headers.get('cf-ipcountry') === 'CN') {
    return new Response(null, {
      headers: { 
        'X-Force-Region': 'hkg1',
        'Cache-Control': 'public, max-age=60'
      }
    });
  }
  
  return new Response(null, { headers: { 'X-Region': 'auto' } });
}