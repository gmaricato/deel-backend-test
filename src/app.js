const express = require('express');
const moment = require('moment')
const bodyParser = require('body-parser');
const {sequelize, Sequelize, Contract} = require('./model')
const {getProfile} = require('./middleware/getProfile')
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

/**
 * FIX ME!
 * @returns contract by id
 */

const getClientId = req => req.profile.dataValues.id
const getModel = req => req.app.get('models')

app.get('/contracts/:id',getProfile ,async (req, res) => {
  try {
    const {Contract} = getModel(req)
    const ClientId = getClientId(req)
    const {id} = req.params
    const contract = await Contract.findOne({where: {id, ClientId}})
    if(!contract) return res.status(404).end('No contract found for the informed id')
    res.json(contract)
  } catch (error) {
    res.status(404).end()
  }
})

app.get('/contracts', getProfile, async (req, res) => {
  try {
    const {Contract} = getModel(req)
    const ClientId = getClientId(req)
    const where = {
      ClientId,
      status: {
        [Sequelize.Op.or]: [
          'new',
          'in_progress',
        ],
      },
    };
    const contracts = await Contract.findAll({ where })
    res.json(contracts); 
  } catch (error) {
    res.status(404).end('Error finding contracts')
  }
})

const getUnpaidJobs = async (req, userId) => {
  try {
    const {Contract, Job} = getModel(req)
    const ClientId = userId || getClientId(req)
    const contractSelector = {
      ClientId,
      status:  'in_progress',
    };
    const contracts = await Contract.findAll({ where: contractSelector })
    let unpaidJobs = [];
    await Promise.all(contracts.map(async contract => {
      const jobSelector = {
        ContractId: contract.dataValues.id,
      }
      const jobs = await Job.findAll({ where: jobSelector })
      unpaidJobs.push(jobs.filter(job => !job.dataValues.paid))
    }))
    return unpaidJobs
  } catch (error) {
    throw 'Error finding unpaid jobs'
  }
}

app.get('/jobs/unpaid', getProfile, async (req, res) => {
  try {
    const unpaidJobs = await getUnpaidJobs(req)
    res.json(...unpaidJobs);   
  } catch (error) {
    res.status(404).end('Error finding unpaid jobs')
  }
})

app.post('/jobs/:job_id/pay', getProfile, async (req, res) => {
  try {
    const {Contract, Job, Profile} = getModel(req)
    const ClientId = getClientId(req)
    const {job_id: ContractId} = req.params

    const job = await Job.findOne({ where: { ContractId } })
    if (!job) throw 'Job not found'
    if (job.paid) throw 'Job already paid'
    const { price } = job.dataValues
    
    const contract = await Contract.findOne({where: {id: ContractId, ClientId, status:  'in_progress'}})
    const { ContractorId } = contract

    const client = await Profile.findOne({where: {id: ClientId}});
    const {balance} = client.dataValues
    
    if (balance < price) {
      throw 'Invalid balance'
    }

    const contractor = await Profile.findOne({where: {id: ContractorId}})
    if (!contractor) throw 'Contractor not found'
    contractor.balance += price
    await contractor.save();

    client.balance -= price
    await client.save()

    job.paid = true
    job.paymentDate = new Date()
    await job.save()

    contract.status = 'terminated'
    await contract.save()
    res.json({message: 'Success'});   
  } catch (error) {
    res.status(404).end(error)
  }
})

app.post('/balances/deposit/:userId/:amount', async (req, res) => {
  try {
    const {Profile} = getModel(req)
    const {userId, amount} = req.params
    const unpaidJobs = getUnpaidJobs(userId)
    let unpaidJobsAmount = 0
    unpaidJobs.map(job => unpaidJobsAmount += job.dataValues.price)

    if (amount > 0.25 * unpaidJobsAmount) {
      throw 'Invalid deposit amount'
    }
    const client =  await Profile.findOne({ where: { id: userId }})
    client.balance += amount
    client.save()
    res.json({message: 'Success'});   
  } catch (error) {
    res.status(404).end(error)
  }
})

const toDate = (date, addDay) => {
  const [day, month, year] = date.split(/[-/]/g);
  let response = moment(new Date(year, month - 1, day)).toDate();
  if (addDay) {
    response = moment(response)
      .add(1, 'day')
      .toDate();
  }
  return response;
};
app.get('/admin/best-profession?', async (req, res) => {
  try {
    const {Job, Contract, Profile} = getModel(req)
    const {start, end} = req.query
    console.log(toDate(start).toISOString())
    console.log(toDate(end).toISOString())

    const where = {
      paid: true,
      paymentDate: {
        [Sequelize.Op.gte]: toDate(start).toISOString(),
        [Sequelize.Op.lte]: toDate(end).toISOString()
      }
    }
    const jobs = await Job.findAll({where})
    const payments = {}

    jobs.map(job => {
      if (!payments[job.dataValues.ContractId]) {
        return payments[job.dataValues.ContractId] = job.dataValues.price
      }
      payments[job.dataValues.ContractId] += job.dataValues.price
    })
    const ContractId = Object.keys(payments).reduce((a, b) => payments[a] > payments[b] ? a : b);
    const contract = await Contract.findOne({ where: {id: ContractId}})
    const {ClientId} = contract.dataValues
    const client = await Profile.findOne({where: {id: ClientId}})
    const { profession } = client
    res.json(profession);   
  } catch (error) {
    res.status(404).end(error)
  }
})
module.exports = app;
