const sql = require('mssql');
const config = require('./config');

jsonKeysToLowerCase = (record) => Object.fromEntries(
    Object.entries(record).map(([k, v]) => [k[0].toLowerCase() + k.substring(1), v]));

addEndpointToReq = (req) => {
    let route = req.route.path.substring(1);
    req.hasQuery = req.query !== undefined;
    req.queryParamCount = Object.keys(req.query).length;
    const hasId = route.endsWith('/:Id');
    if (hasId) route = route.substring(0, route.length - 4);
    req.endpoint = route;
    req.hasId = hasId;
};

addParameters = (req) => {
    if (req.hasId) req.sql += `@Id=${req.params.Id}, `;
    req.urlParameters = '';

    Object.getOwnPropertyNames(req.query).forEach(param => {
        if (!isNaN(req.query[param]))
            req.sql += `@${param}=${req.query[param]}, `
        else if (typeof req.query[param] === 'boolean')
            req.sql += req.query[param] ? `1, ` : `0, `
        else if (typeof req.query[param] === 'string')
            req.sql += `@${param}='${req.query[param]}', `

        req.urlParameters += `${param}=${req.query[param]}&`
    });

    req.urlParameters = req.urlParameters.substring(0, req.urlParameters.length - 1);
    if (req.urlParameters.length > 0) req.urlParameters = `?${req.urlParameters}`;

    Object.getOwnPropertyNames(req.params).forEach(param => {
        if (param != 'Id')
            if (!isNaN(req.params[param]))
                req.sql += `@${param}=${req.params[param]}, `
        else if (typeof req.params[param] === 'boolean')
            req.sql += req.params[param] ? `1, ` : `0, `
        else if (typeof req.params[param] === 'string')
            req.sql += `@${param}='${req.params[param]}', `
    });

    if (req.sql.endsWith(', ')) req.sql = req.sql.substring(0, req.sql.length - 2);
};

addBodyParameters = (req) => {
    let parameters = '';

    Object.getOwnPropertyNames(req.body).forEach(param => {
        if (param !== 'Id') {
            if (!isNaN(req.body[param])) {
                parameters += `, @${param}=${req.body[param]}`;
            } else if (typeof req.body[param] === 'boolean')
                parameters += req.body[param] ? `1,` : `0,`;
            else if (typeof req.body[param] === 'string')
                parameters += `, @${param}='${req.body[param]}'`;
        }
    });

    if (req.hasId) {
        req.sql += parameters.endsWith(', ') ? parameters.substring(2, parameters.length) : parameters;
    } else {
        req.sql += parameters.startsWith(', ') ? parameters.substring(2, parameters.length) : parameters;
    }
};

createQuery = (req, removeEnding = null) => {
    addEndpointToReq(req);
    let method = req.method === 'PUT' ? 'Update' :
        req.method === 'POST' ? 'Add' :
        req.method;

    if (req.hasId && removeEnding && req.method === 'GET') {
        req.sql = `${method}${req.endpoint.split(removeEnding)[0]} `;
    } else if (req.endpoint.toLowerCase() === 'customers' && req.queryParamCount >= 1) {
        req.sql = `${method}${req.endpoint.substring(0, req.endpoint.length - 1)} `;
    } else if (req.endpoint.toLowerCase() === 'basiccarts') {
        req.sql = `${method}${req.endpoint.substring(0, req.endpoint.length - 1)} `;
    } else if (req.endpoint.toLowerCase() === 'favoritescounts') {
        req.sql = `${method}${req.endpoint.substring(0, req.endpoint.length - 6)} `;
    } else if (removeEnding && req.method !== 'GET') {
        req.sql = `${method}${req.endpoint.split(removeEnding)[0]} `;
    } else if (req.endpoint.endsWith('ies') && (req.method !== 'GET' || (req.method === 'GET' && (req.hasId || req.queryParamCount > 1)))) {
        req.sql = `${method}${req.endpoint.substring(0, req.endpoint.length - 3)}y `;
    } else if (req.endpoint.endsWith('es') && (req.method !== 'GET' || (req.method === 'GET' && (req.hasId || req.queryParamCount > 1)))) {
        req.sql = `${method}${req.endpoint.substring(0, req.endpoint.length - 2)} `;
    } else if (req.endpoint.endsWith('s') && (req.method !== 'GET' || (req.method === 'GET' && (req.hasId || req.queryParamCount > 1)))) {
        req.sql = `${method}${req.endpoint.substring(0, req.endpoint.length - 1)} `;
    } else {
        req.sql = `${method}${req.endpoint} `;
    }

    addParameters(req);
    if (req.method !== 'GET') addBodyParameters(req);
    req.sql = `EXEC ${req.sql}`;
};

callDatabase = async (req, res) => {
    try {
        await sql.connect(config);
        let result = await sql.query(req.sql);

        if (req.method == 'GET' && result.recordset.length == 0) {
            res.status(404);
            res.sqlError = 'Could not find the resource.';
        }

        if (req.method == 'PUT' || req.method == 'DELETE') res.status(204);
        else if (req.method == 'POST') res.status(201);
        res.message =
            req.method == 'PUT' ? 'Updated successfuly.' :
            req.method == 'DELETE' ? 'Deleted successfully.' : '';

        return result;
    } catch (err) {
        res.sqlError = req.method = 'GET' ? 'Could not find the resource.' :
            req.method == 'PUT' ? 'Could not update the resource.' :
            req.method == 'POST' ? 'Could not create the resource.' :
            req.method == 'DELETE' ? 'Could not delete the resource.' : 'Bad request.';

        res.status(400);
    }
};

createHateoasLinks = (req, records, hateoas) => {
    return records.recordset.map((record) => {
        record.links = {};

        let specialCase = ['productcategories', 'reviews', 'favorites', 'cartproducts'];
        let hasspecialCase = specialCase.includes(req.endpoint.toLowerCase());

        hateoas.forEach((link) => {
            let baseUrl = `http://${req.headers.host}/api/${link.endpoint}/`;

            let propVerify = (record[link.property] !== undefined && record[link.property2] !== undefined) ? true : false;

            if (req.hasId) {
                record.links[link.property.toLowerCase() == 'id' ? 'self' : link.property.toLowerCase()] =
                    `${baseUrl}${record[link.property]}`
            } else if (hasspecialCase && propVerify) {
                record.links['self'] = `${baseUrl}?${[link.property]}=${record[link.property]}&${[link.property2]}=${record[link.property2]}`
            } else {
                record.links['self'] = `${baseUrl}${req.urlParameters || record[link.property]}`
            }
        });
        return record;
    });
};

get = async (req, res, removeEnding) => {
    try {
        createQuery(req, removeEnding);
        const result = await callDatabase(req, res);

        if (res.sqlError) return res.send(res.sqlError);

        if (req.endpoint.toLowerCase() === 'promotypes') {
            req.endpoint = req.endpoint.substring(0, req.endpoint.length - 1);
        }

        let hateoas = [];

        if (req.endpoint.toLowerCase() === 'productcategories') {
            hateoas = [{
                property: 'ProductId',
                property2: 'CategoryId',
                endpoint: `${req.endpoint}`
            }]
        } else if (req.endpoint.toLowerCase() === 'reviews') {
            hateoas = [{
                property: 'ProductId',
                property2: 'CustomerId',
                endpoint: `${req.endpoint}`
            }]
        } else if (req.endpoint.toLowerCase() === 'favorites') {
            hateoas = [{
                property: 'ProductId',
                property2: 'CustomerId',
                endpoint: `${req.endpoint}`
            }]
        } else if (req.endpoint.toLowerCase() === 'cartproducts') {
            hateoas = [{
                property: 'CustomerId',
                property2: 'ProductId',
                endpoint: `${req.endpoint}`
            }]
        } else {
            hateoas = [{
                property: 'Id',
                endpoint: `${req.endpoint}`
            }];
        }

        const records = createHateoasLinks(req, result, hateoas);

        return res.json(req.hasId > 0 || req.queryParamCount > 1 ? records[0] : records);
    } catch (err) {
        console.log(err);
        throw err;
    }
};

modify = async (req, res, removeEnding) => {
    try {
        createQuery(req, removeEnding);
        const result = await callDatabase(req, res);

        if (res.sqlError) return res.send(res.sqlError);

        if (res.message.length > 0) return res.send(res.message);

        if (result.recordset == undefined && req.method === 'POST')
            return res.send('Resource added.');
        else
            return res.json(jsonKeysToLowerCase(result.recordset[0]));
    } catch (err) {
        console.log(err);
        throw err;
    }
};

module.exports = {
    get,
    modify
};