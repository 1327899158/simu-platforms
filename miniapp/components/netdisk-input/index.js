const {request}=require('../../utils/request');
Component({properties:{kind:{type:String,value:'DOC'},orderId:String,disabled:Boolean,submitText:{type:String,value:'添加网盘资料'}},data:{url:'',password:'',busy:false},methods:{
 inputUrl(e){this.setData({url:e.detail.value});},inputPassword(e){this.setData({password:e.detail.value});},
 async add(){if(this.data.busy||this.data.disabled)return;this.setData({busy:true});try{
  const file=await request('POST','/files/netdisk',{url:this.data.url.trim(),password:this.data.password.trim(),kind:this.data.kind,orderId:this.data.orderId||null});
  this.triggerEvent('added',{...file,fileId:file.id,sizeText:'网盘资料'});this.setData({url:'',password:''});
 }catch(e){wx.showToast({title:e.message||'添加失败',icon:'none'});}finally{this.setData({busy:false});}}
}});
