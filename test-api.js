#!/usr/bin/env node

/**
 * Simple API test script for the caching server
 * Tests basic endpoints before client integration
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3000';

async function testEndpoint(path, options = {}) {
  const url = `${BASE_URL}/api/cache?${path}`;
  console.log(`\n🧪 Testing: ${url}`);
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    const contentType = response.headers.get('content-type');
    console.log(`📊 Status: ${response.status} ${response.statusText}`);
    console.log(`📋 Content-Type: ${contentType}`);
    
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      console.log(`📦 Response:`, JSON.stringify(data, null, 2));
    } else {
      const text = await response.text();
      console.log(`📄 HTML Response (first 300 chars):`, text.substring(0, 300));
    }
    
    return response.ok;
    
  } catch (error) {
    console.error(`❌ Request failed:`, error.message);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Starting API Tests');
  console.log(`🎯 Base URL: ${BASE_URL}`);
  
  const tests = [
    // Basic test
    { name: 'Basic Test', path: 'type=test' },
    
    // Health check
    { name: 'Health Check', path: 'type=health' },
    
    // Invalid type (should return 400)
    { name: 'Invalid Type', path: 'type=invalid' },
    
    // Photo batch (POST)
    { 
      name: 'Photo Batch API', 
      path: 'type=photo-urls-batch',
      options: {
        method: 'POST',
        body: JSON.stringify({
          photo_paths: ['test1.jpg', 'test2.jpg'],
          event_id: 'test-event',
          expires_in: 3600
        })
      }
    }
  ];
  
  let passed = 0;
  let total = tests.length;
  
  for (const test of tests) {
    const success = await testEndpoint(test.path, test.options);
    if (success) {
      console.log(`✅ ${test.name}: PASSED`);
      passed++;
    } else {
      console.log(`❌ ${test.name}: FAILED`);
    }
  }
  
  console.log(`\n🏁 Results: ${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log('🎉 All tests passed! API is working correctly.');
    process.exit(0);
  } else {
    console.log('⚠️  Some tests failed. Check server logs and configuration.');
    process.exit(1);
  }
}

// Run tests
runTests().catch(console.error);