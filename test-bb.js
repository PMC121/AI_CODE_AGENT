import axios from 'axios';
import 'dotenv/config';

async function testBb() {
  const { BITBUCKET_BASEURL, BITBUCKET_WORKSPACE, BITBUCKET_REPO_SLUG, BITBUCKET_TOKEN } = process.env;
  
  const baseUrl = BITBUCKET_BASEURL ? `${BITBUCKET_BASEURL.replace(/\/$/, '')}/rest/api/1.0` : 'https://api.bitbucket.org/2.0';
  
  console.log('Base URL configured:', baseUrl);
  
  const bbHttp = axios.create({
    baseURL: baseUrl,
    auth: {
      username: 'Prashant3731',
      password: BITBUCKET_TOKEN
    },
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
  });

  try {
    const url = `/projects/${BITBUCKET_WORKSPACE}/repos/${BITBUCKET_REPO_SLUG}`;
    console.log('GET', url);
    const res = await bbHttp.get(url);
    console.log('GET SUCCESS ✓', res.data.name);
  } catch (err) {
    console.log('GET ERROR ✖', err.response?.status, err.message);
    if (err.response?.data) console.log(JSON.stringify(err.response.data, null, 2));
  }
}

testBb();
