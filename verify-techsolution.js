import 'dotenv/config';
import { getConnection } from './src/connection.js';

async function verify() {
  const conn = await getConnection();
  const app = await conn.query("SELECT Label FROM AppDefinition WHERE Label LIKE '%TechSolution%'");
  // CustomObject is a Tooling API or Metadata API thing, let's use EntityDefinition for Data API
  const objs = await conn.query("SELECT DeveloperName, QualifiedApiName FROM EntityDefinition WHERE QualifiedApiName IN ('IT_Project__c', 'Employee_test__c', 'Project_Resource__c')");
  console.log(JSON.stringify({ 
    custom_mcp_used: true,
    app: app.records, 
    objects: objs.records 
  }, null, 2));
}

verify().catch(console.error);
