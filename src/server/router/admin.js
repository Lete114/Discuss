const bcrypt = require('bcryptjs')
const { jwtSign, DeepColne, GetAvatar } = require('../utils')

const { SECRET, VerifyToken } = require('../utils/adminUtils')
const {
  GetCommentCounts,
  limitPageNo,
  DeleteComment,
  UpdateComment
} = require('../utils/commentUtils')
const { VerifyParams, IndexHandler } = require('../utils')

/**
 * 初始化管理员，并将信息发送到全局
 */
async function init(body) {
  const { Admin } = global.DiscussDB
  global.Dconfig = (await Admin.select({}))[0]
  // 如果已有则直接退出
  if (global.Dconfig) return
  const { username, password, mail } = body
  VerifyParams(body, ['username', 'password', 'mail'])
  const options = {
    username,
    password: bcrypt.hashSync(password, 10),
    mail,
    domain: '',
    requestHeaders: '',

    // 评论处理
    commentCount: 6,
    wordNumber: '0',
    limit: 0,
    limitAll: 0,
    akismet: '',
    avatarCdn: 'https://cravatar.cn/avatar/',

    // 邮件提醒
    siteUrl: '',
    serverURLs: '',
    mailHost: '',
    mailPort: '',
    mailFrom: '',
    mailAccept: '',
    masterSubject: '',
    masterTemplate: '',
    replySubject: '',
    replyTemplate: ''
  }
  global.Dconfig = await Admin.add(options)
}

/**
 * 登录 并且返回token
 * @param {String} username 用户名
 * @param {String} password 密码
 * @param {String} token token
 * @returns
 */
async function Login(params) {
  const config = global.Dconfig

  const { username, password, token } = params
  const result = {}

  // 判断token是否有效
  if (token) {
    const isToken = await VerifyToken(token)
    if (!isToken) throw new Error('Token expired')
    result.token = token
    return result
  }

  // 验证评论信息是否合法
  VerifyParams(params, ['username', 'password'])

  const isUsername = username === config.username
  const isPassword = bcrypt.compareSync(password, config.password)
  // 用户名密码是否正确
  if (!isUsername || !isPassword) throw new Error('User name or password error')

  result.token = jwtSign({ id: config.id }, SECRET, { expiresIn: '7d' })
  return result
}

/**
 * 模糊多条件查询
 * @param {*} options
 * @param {*} keyword
 * @param {*} searchType
 * @returns
 */
function FuzzyQueries(options, keyword, searchType) {
  if (!keyword) return

  // 默认查询全部字段
  if (searchType === 'all') {
    delete options.path
    options._complex = { _logic: 'OR' }
    const arr = ['nick', 'mail', 'site', 'ip', 'content', 'path']
    for (const i of arr) {
      options._complex[i] = ['LIKE', `%${keyword}%`]
    }
  } else {
    // 指定字段
    options[searchType] = ['LIKE', `%${keyword}%`]
  }
}

/* eslint-disable max-statements */
/**
 * 管理员获取评论
 * @param {Object} params
 * @returns
 */
async function AdminGetComments(params) {
  const { Comment } = global.DiscussDB
  const config = global.Dconfig

  const token = await VerifyToken(params.token)
  if (!token) throw new Error('Token exception')

  let { pageSize } = params
  if (!pageSize) pageSize = config.commentCount
  const { pageNo, keyword, searchType, status, path } = params

  const options = { status }

  if (status === 'current') {
    options.path = IndexHandler(path)
    delete options.status
  }

  // 查询博主评论
  if (status === 'master') {
    delete options.status
    options.mail = config.mail
  }

  // 模糊查询
  FuzzyQueries(options, keyword, searchType)

  const counts = await GetCommentCounts(options, false)

  // 限制页码
  const { page, pageCount } = await limitPageNo(pageNo, pageSize, options)

  // 分页查询
  const comments = await Comment.select(options, {
    offset: (page - 1) * pageSize,
    limit: pageSize,
    desc: 'created'
  })

  for (const item of comments) {
    // 处理头像
    item.avatar = GetAvatar(item.avatar)

    item.time = item.created

    // 删除多余信息
    delete item.status
    delete item.created
    delete item.updated
  }

  const result = { comments, counts, pageCount, pageSize }

  return result
}

/* eslint-enable max-statements  */

/**
 * 操作评论
 * @param {Array} id
 * @param {String} exec
 * @param {String} token
 * @param {Array} comment
 * @returns
 */
async function OperateComment({ id, exec, token, comment }) {
  // 判断是否为管理员身份
  const isToken = await VerifyToken(token)
  if (!isToken) throw new Error('Token exception')

  // 判断操作是否为删除，如果不是则为修改
  if (exec === 'delete') return await DeleteComment(id)

  return await UpdateComment(id, exec, comment)
}

// 获取配置信息
async function GetConfig({ token }) {
  const isToken = await VerifyToken(token)
  if (!isToken) throw new Error('Token exception')

  const config = DeepColne(global.Dconfig)
  delete config.id
  delete config.password
  return config
}

// 保存配置信息
async function SaveConfig(params) {
  const { Admin } = global.DiscussDB

  const { data, token } = params

  const isToken = await VerifyToken(token)
  if (!isToken) throw new Error('Token exception')

  // 修改密码处理
  if (data.password) data.password = bcrypt.hashSync(data.password, 10)

  // 转换为数字类型
  data.limit = parseInt(data.limit)
  data.limitAll = parseInt(data.limitAll)
  data.commentCount = parseInt(data.commentCount)

  const siteUrl = data.siteUrl === null || data.siteUrl === void 0
  data.siteUrl = siteUrl ? void 0 : data.siteUrl.replace(/\/$/, '')

  const { id } = global.Dconfig
  global.Dconfig = (await Admin.update(data, { id }))[0]
}

module.exports = {
  init,
  Login,
  AdminGetComments,
  GetConfig,
  SaveConfig,
  OperateComment
}
