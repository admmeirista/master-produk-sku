function appUiVersion_(){
  return shopeeSignature_(['Index','Styles','Logo','Scripts','Pages','Ops','SkuPicker','PackageForm','Shopee','ShopeePackage','ShopeeReviewHelpers','ShopeeWorkflow','ShopeeWorkspace','ShopeeSelection','ShopeeBatch','Wizard','Photo','Mobile','AppUpdate'].map(include));
}
